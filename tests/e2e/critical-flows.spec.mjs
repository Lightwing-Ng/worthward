/* Code version: v1.167.49 */
import {expect, test} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const fixturePath = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const setSidebarExpanded = async (page, expanded) => {
    const toggle = page.locator('#sidebar_toggle');
    const expected = String(expanded);
    if (await toggle.getAttribute('aria-expanded') !== expected) {
        await toggle.click();
    }
    await expect(toggle).toHaveAttribute('aria-expanded', expected);
};

const tapAtCenter = async (page, locator) => {
    const box = await locator.boundingBox();
    if (!box) throw new Error('Cannot tap an element without a layout box');
    await page.touchscreen.tap(box.x + (box.width / 2), box.y + (box.height / 2));
};

const fulfillInertPriceLiveResponse = async (route, tickers = []) => {
    await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
            success: true,
            liveSessionActive: false,
            series: tickers.map((ticker) => ({
                ticker,
                raw_dates: ['2026-07-10 09:30'],
                dates: ['10 Jul 2026 09:30'],
                prices: [null],
                candlestick_prices: [{x: 0, o: null, h: null, l: null, c: null}],
            })),
        }),
    });
};

const mockInvestmentReadApis = async (page, {
    transactions = [],
    startingCash = 10000,
    tradingDays = [],
    intradayRows = null,
    brokers = ['ibkr'],
    priceHistoryByTicker = {},
    tickerProfiles = {},
    moneyMarketTickers = [],
    knownTickerCompanyNames = {},
    cashEquivalentTickers = [],
    realtimeQuotes = [],
    marketSession = {},
    fxRateHistoryByCurrency = {},
    manualInternalTransferBindings = {},
    manualInternalTransferIgnoredSourceKeys = [],
    manualSecurityTransferAttributions = {},
    summary = {},
    brokerSummaries = {},
    positionSnapshot = null,
} = {}) => {
    const readRealtimeQuotes = () => (
        typeof realtimeQuotes === 'function' ? realtimeQuotes() : realtimeQuotes
    );
    const readMarketSession = (url) => (
        typeof marketSession === 'function' ? marketSession(url) : marketSession
    );
    await page.route('**/api/investment/transactions*', async (route) => {
        if (route.request().method() !== 'GET') {
            await route.abort();
            return;
        }
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                transactions,
                starting_cash: startingCash,
                base_currency: 'USD',
                brokers,
                ticker_profiles: tickerProfiles,
                price_history_by_ticker: priceHistoryByTicker,
                price_history_failures: [],
                money_market_tickers: moneyMarketTickers,
                cash_equivalent_tickers: cashEquivalentTickers,
                ticker_lineage: {},
                known_ticker_company_names: knownTickerCompanyNames,
                fx_rate_history_by_currency: fxRateHistoryByCurrency,
                manual_internal_transfer_bindings: manualInternalTransferBindings,
                manual_internal_transfer_ignored_source_keys: manualInternalTransferIgnoredSourceKeys,
                manual_security_transfer_attributions: manualSecurityTransferAttributions,
                summary,
                broker_summaries: brokerSummaries,
                position_snapshot: positionSnapshot,
                realtime_quotes: readRealtimeQuotes(),
                section_freshness: {},
            }),
        });
    });
    await page.route('**/api/investment/realtime-quotes?*', async (route) => {
        await route.fulfill({contentType: 'application/json', body: JSON.stringify({success: true, quotes: readRealtimeQuotes()})});
    });
    await page.route('**/api/market-session/us-equity?*', async (route) => {
        const url = new URL(route.request().url());
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                market: 'us_equity',
                session: 'off',
                is_trading_day: false,
                is_realtime_allowed: false,
                session_date: '',
                trading_days: tradingDays,
                ...readMarketSession(url),
            }),
        });
    });
    if (typeof intradayRows === 'function') {
        await page.route('**/api/investment/intraday?*', async (route) => {
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({success: true, rows: intradayRows(new URL(route.request().url()))}),
            });
        });
    }
};

const assertCompleteStandardInvestmentExportPayload = (payload, expectedBrokerCodes) => {
    expect(payload).toEqual(expect.objectContaining({transactions: expect.any(Array)}));
    expect(payload.transactions.length).toBeGreaterThan(0);
    const expectedBrokers = new Set(expectedBrokerCodes);
    const securityTypes = new Set([
        'buy',
        'sell',
        'dividend_reinvestment',
        'foreign_tax_withholding',
        'grant',
        'payment_in_lieu',
        'transfer_in',
        'transfer_out',
    ]);
    const quantityTypes = new Set([
        'buy',
        'sell',
        'dividend_reinvestment',
        'grant',
        'transfer_in',
        'transfer_out',
    ]);
    const priceTypes = new Set(['buy', 'sell', 'dividend_reinvestment']);

    for (const transaction of payload.transactions) {
        expect(transaction.broker).toEqual(expect.any(String));
        expect(transaction.type).toEqual(expect.any(String));
        expect(transaction.currency).toEqual(expect.any(String));
        expect(Boolean(transaction.datetime || transaction.date)).toBe(true);
        const hasLedgerIdentity = transaction.ledger_no !== null
            && transaction.ledger_no !== undefined
            && String(transaction.ledger_no).trim() !== '';
        const hasSourceIdentity = Boolean(String(
            transaction.source?.reference_id || transaction.source?.execution_key || '',
        ).trim());
        const hasStableFingerprint = Boolean(
            (transaction.datetime || transaction.date)
            && transaction.type
            && transaction.currency
            && (
                transaction.ticker
                || transaction.amount !== undefined
                || transaction.net_amount_raw !== undefined
            )
        );
        expect(hasLedgerIdentity || hasSourceIdentity || hasStableFingerprint).toBe(true);

        if (securityTypes.has(transaction.type)) {
            expect(String(transaction.ticker || '').trim()).not.toBe('');
        }
        if (quantityTypes.has(transaction.type)) {
            const quantity = transaction.quantity_raw
                ?? transaction.quantity_abs
                ?? transaction.quantity
                ?? transaction.normalized?.position_quantity;
            expect(quantity).not.toBeNull();
            expect(quantity).not.toBeUndefined();
        }
        if (priceTypes.has(transaction.type)) {
            const price = transaction.price_raw
                ?? transaction.price
                ?? transaction.normalized?.unit_price;
            expect(price).not.toBeNull();
            expect(price).not.toBeUndefined();
        }
    }

    expect(new Set(payload.transactions.map((transaction) => transaction.broker)))
        .toEqual(expectedBrokers);
};

test('switches Broker access between IBKR and Longbridge OAuth without credential fields', async ({page}) => {
    await page.goto('/settings/broker-access');

    const brokerSelect = page.locator('#selected_broker');
    await expect(brokerSelect.locator('option[value="ibkr"]')).toHaveCount(1);
    await expect(brokerSelect.locator('option[value="longbridge"]')).toHaveCount(1);

    await brokerSelect.evaluate((select) => {
        select.value = 'longbridge';
        select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    const longbridgeFields = page.locator('[data-broker-fields="longbridge"]');
    await expect(longbridgeFields).toHaveCount(2);
    await expect(longbridgeFields.first()).toBeVisible();
    await expect(longbridgeFields.nth(1)).toBeVisible();
    await expect(page.locator('[data-broker-fields="ibkr"]')).toBeHidden();
    await expect(page.getByRole('button', {name: 'Authorize in browser'})).toBeVisible();
    await expect(page.locator('input[name="longbridge_access_token"]')).toHaveCount(0);

    await brokerSelect.evaluate((select) => {
        select.value = 'ibkr';
        select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await expect(page.locator('[data-broker-fields="ibkr"]')).toBeVisible();
    await expect(longbridgeFields.first()).toBeHidden();
    await expect(longbridgeFields.nth(1)).toBeHidden();
    await expect(page.getByText('Direct IBKR connectivity is not configured.')).toBeVisible();
    await expect(page.locator('[data-broker-fields="ibkr"] input')).toHaveCount(0);
    await expect(page.locator('[data-broker-fields="ibkr"] button')).toHaveCount(0);
});

test('stacks Email SMTP action packages like the Broker access form', async ({page}) => {
    await page.goto('/settings/broker-access');
    const brokerFormLayout = await page.locator('.settings-shell-broker-access form.settings-form-shell').evaluate((form) => {
        const style = getComputedStyle(form);
        return {
            display: style.display,
            columnCount: style.gridTemplateColumns.split(' ').length,
            rowGap: style.rowGap,
        };
    });

    await page.goto('/settings/email-smtp');
    const emailActions = page.locator('.settings-email-smtp-form > .settings-action-package-grid');
    const emailLayout = await emailActions.evaluate((grid) => {
        const style = getComputedStyle(grid);
        const cards = Array.from(grid.children).map((card) => {
            const bounds = card.getBoundingClientRect();
            return {
                top: bounds.top,
                bottom: bounds.bottom,
                width: bounds.width,
            };
        });
        return {
            display: style.display,
            columnCount: style.gridTemplateColumns.split(' ').length,
            rowGap: style.rowGap,
            width: grid.getBoundingClientRect().width,
            cards,
        };
    });

    expect(emailLayout.display).toBe(brokerFormLayout.display);
    expect(emailLayout.columnCount).toBe(brokerFormLayout.columnCount);
    expect(emailLayout.rowGap).toBe(brokerFormLayout.rowGap);
    expect(emailLayout.cards).toHaveLength(2);
    expect(emailLayout.cards[0].width).toBeCloseTo(emailLayout.width, 1);
    expect(emailLayout.cards[1].width).toBeCloseTo(emailLayout.width, 1);
    expect(emailLayout.cards[1].top).toBeGreaterThan(emailLayout.cards[0].bottom);
});

test('resolves Longbridge OAuth notice into verified connection feedback', async ({page, baseURL}) => {
    let statusRequestCount = 0;
    await page.route('**/api/settings/longbridge-oauth/status', async (route) => {
        statusRequestCount += 1;
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                status: 'success',
                message: 'Successfully connected to Longbridge via CLI OAuth.',
                token_status: 'valid',
            }),
        });
    });
    await page.context().addCookies([{
        name: 'antigravity_settings_feedback',
        value: JSON.stringify({
            notice: 'Longbridge authorization opened in your browser. Complete it there, then return here and test the connection.',
            longbridge_oauth_pending: '1',
        }),
        url: `${baseURL}/settings/broker-access`,
    }]);

    await page.goto('/settings/broker-access');

    const banner = page.locator('.notice-floating-banner-global');
    await expect(banner.locator('.notice-floating-banner-heading')).toHaveText('Connected');
    await expect(banner.locator('.notice-floating-banner-copy')).toHaveText('Successfully connected to Longbridge via CLI OAuth.');
    await expect(page.locator('[data-broker-test-feedback]')).toContainText('Successfully connected to Longbridge via CLI OAuth.');
    await expect(page.locator('[data-broker-connection-health]')).toBeVisible();
    await expect(page.locator('[data-broker-connection-summary]')).toContainText('including latency');
    const connectionLayout = await page.locator('.settings-action-package:has([data-broker-connection-health])').evaluate((card) => {
        const icon = card.querySelector('.settings-action-package-icon-shell');
        const health = card.querySelector('[data-broker-connection-health]');
        const title = card.querySelector('.settings-service-name');
        const toBounds = (element) => {
            const bounds = element.getBoundingClientRect();
            return {left: bounds.left, right: bounds.right};
        };
        return {icon: toBounds(icon), health: toBounds(health), title: toBounds(title)};
    });
    expect(connectionLayout.health.left).toBeGreaterThanOrEqual(connectionLayout.icon.right);
    expect(connectionLayout.health.right).toBeLessThanOrEqual(connectionLayout.title.left);
    expect(statusRequestCount).toBe(1);
    await expect(banner).toBeHidden({timeout: 8000});
});

test('stops Longbridge OAuth polling when the status service returns a JSON 503 error', async ({page, baseURL}) => {
    let statusRequestCount = 0;
    await page.route('**/api/settings/longbridge-oauth/status', async (route) => {
        statusRequestCount += 1;
        await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
                status: 'error',
                message: 'Longbridge authorization status is temporarily unavailable. Try again later.',
            }),
        });
    });
    await page.context().addCookies([{
        name: 'antigravity_settings_feedback',
        value: JSON.stringify({longbridge_oauth_pending: '1'}),
        url: `${baseURL}/settings/broker-access`,
    }]);

    await page.goto('/settings/broker-access');

    await expect(page.locator('[data-broker-test-feedback]')).toContainText(
        'Longbridge authorization status is temporarily unavailable. Try again later.',
    );
    expect(statusRequestCount).toBe(1);
});

test('reports a sustained Longbridge OAuth status connection failure', async ({page, baseURL}) => {
    let statusRequestCount = 0;
    await page.route('**/api/settings/longbridge-oauth/status', async (route) => {
        statusRequestCount += 1;
        await route.abort('failed');
    });
    await page.context().addCookies([{
        name: 'antigravity_settings_feedback',
        value: JSON.stringify({longbridge_oauth_pending: '1'}),
        url: `${baseURL}/settings/broker-access`,
    }]);

    await page.goto('/settings/broker-access');

    await expect(page.locator('[data-broker-test-feedback]')).toContainText(
        'Longbridge authorization status checks could not reach this app after 3 attempts.',
        {timeout: 7000},
    );
    expect(statusRequestCount).toBe(3);
});

test('keeps the settings action package aligned and demonstrates maintenance activity safely', async ({page}) => {
    await page.goto('/settings/style-tokens');

    const actionPackage = page.locator('[data-style-token-action-package]');
    const marker = actionPackage.locator('[data-action-package-live-marker]');
    const copy = actionPackage.locator('[data-action-package-copy]');
    const button = actionPackage.locator('[data-action-package-button]');
    const liveControl = page.locator('[data-style-token-action-package-live]');

    await expect(actionPackage).toBeVisible();
    await expect(marker).toBeHidden();
    const verticalAlignment = await actionPackage.evaluate((card) => {
        const iconBounds = card.querySelector('.settings-action-package-icon-shell').getBoundingClientRect();
        const titleBounds = card.querySelector('.settings-service-name').getBoundingClientRect();
        const formStyles = getComputedStyle(card.querySelector('.settings-action-package-form'));
        return {
            centerDelta: Math.abs(
                (iconBounds.top + (iconBounds.height / 2))
                - (titleBounds.top + (titleBounds.height / 2)),
            ),
            formJustification: formStyles.justifySelf,
        };
    });
    expect(verticalAlignment.centerDelta).toBeLessThanOrEqual(1);
    expect(verticalAlignment.formJustification).toBe('end');
    await expect(button).toHaveAttribute('type', 'button');
    await actionPackage.evaluate((card) => {
        const form = document.createElement('form');
        form.className = 'settings-action-package-form';
        form.dataset.realSubmitProbe = 'true';
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.textContent = 'Real submit';
        form.append(submit);
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            card.dataset.realSubmitReceived = 'true';
        });
        card.append(form);
    });
    await actionPackage.getByRole('button', {name: 'Real submit'}).click();
    await expect(actionPackage).toHaveAttribute('data-real-submit-received', 'true');
    await actionPackage.evaluate((card) => card.querySelector('[data-real-submit-probe]')?.remove());

    await liveControl.check();
    await expect(marker).toBeVisible();
    await button.click();
    await expect(copy).toContainText('Refreshing all cached daily datasets');
    await expect(button).toHaveText('Maintaining');
    await expect(button).toBeDisabled();
    await expect(marker).toBeVisible();
    await expect(button).toHaveText('Maintain all data', {timeout: 3000});
    await expect(copy).toContainText('Refresh every cached daily dataset');
    await expect(marker).toBeVisible();

    await liveControl.uncheck();
    await expect(marker).toBeHidden();
});

test('copies every Style token name from a right-aligned round button with feedback', async ({page}) => {
    await page.goto('/settings/style-tokens');
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: async (value) => {
                    window.__styleTokenCopiedText = value;
                },
            },
        });
    });

    const cards = page.locator('[data-style-token-card]');
    const copyButtons = page.locator('[data-style-token-copy]');
    await expect(copyButtons).toHaveCount(await cards.count());

    const executionCard = page.locator('[data-style-token-card="settings-execution-option"]');
    const executionOption = executionCard.locator('label.settings-general-option');
    const titleRow = executionCard.locator('.style-token-title-row');
    const copyButton = executionCard.locator('[data-style-token-copy]');
    await expect(executionCard.locator('.style-token-title')).toHaveText('Settings execution option');
    await expect(copyButton).toHaveCSS('visibility', 'hidden');
    await expect(copyButton).toHaveCSS('opacity', '0');
    await titleRow.hover();
    await expect(copyButton).toBeVisible();
    await expect(copyButton).toHaveCSS('opacity', '1');
    const optionBorder = await executionOption.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            token: style.getPropertyValue('--settings-general-option-border').trim(),
            borderStyle: style.borderTopStyle,
        };
    });
    expect(optionBorder.token).toMatch(/^0\.5px solid color-mix\(in srgb, .+ 8%, transparent\)$/);
    expect(optionBorder.borderStyle).toBe('solid');

    const stepperInput = page.locator(
        '[data-style-token-card="trade-strategy-stepper"] .style-token-stepper-input',
    );
    await expect(stepperInput).toHaveCSS('height', '24px');
    await expect(copyButton).toHaveAttribute('data-style-token-copy', 'Settings execution option');

    const geometry = await titleRow.evaluate((row) => {
        const button = row.querySelector('[data-style-token-copy]');
        const rowBounds = row.getBoundingClientRect();
        const buttonBounds = button.getBoundingClientRect();
        const themeBounds = document.querySelector('#global_theme_toggle').getBoundingClientRect();
        return {
            themeRightDelta: Math.abs(themeBounds.right - buttonBounds.right),
            titleRowInset: rowBounds.right - buttonBounds.right,
            width: buttonBounds.width,
            height: buttonBounds.height,
            radius: getComputedStyle(button).borderRadius,
        };
    });
    expect(geometry.themeRightDelta).toBeLessThanOrEqual(1);
    expect(geometry.titleRowInset).toBeGreaterThanOrEqual(9);
    expect(geometry.titleRowInset).toBeLessThanOrEqual(11);
    expect(geometry.width).toBe(36);
    expect(geometry.height).toBe(36);
    expect(geometry.radius).toBe('999px');

    await copyButton.click();
    await expect.poll(() => page.evaluate(() => window.__styleTokenCopiedText)).toBe('Settings execution option');
    await expect(copyButton).toHaveClass(/is-copied/);
    await expect(copyButton).toHaveAttribute('aria-label', 'Copied');
    await expect(page.locator('[data-style-token-copy-status]')).toHaveText('Copied: Settings execution option');
});

test('keeps style-token values aligned within their shared value column and omits the primitives specimen', async ({page}) => {
    await page.goto('/settings/style-tokens');

    await expect(page.locator('[data-style-token-card="shared-style-primitives"]')).toHaveCount(0);
    await expect(page.getByText('Shared style primitives', {exact: true})).toHaveCount(0);

    const alignment = await page.evaluate(() => {
        const rangeRight = (element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const rects = [...range.getClientRects()];
            return rects.length ? Math.max(...rects.map((rect) => rect.right)) : null;
        };
        const tooltip = document.querySelector('#tooltip');
        const color = [...tooltip.querySelectorAll('.style-token-value-text')]
            .find((element) => element.textContent.includes('color-mix'));
        const right = [...tooltip.querySelectorAll('.style-token-value-text')]
            .find((element) => element.textContent.trim() === 'right');
        const frosted = [...tooltip.querySelectorAll('.style-token-value-link')]
            .find((element) => element.textContent.trim() === 'Frosted glass');
        const related = document.querySelector('#modal-dialog-banner-message .style-token-related-value');
        const elements = {color, right, frosted, related};
        const contentRights = Object.fromEntries(Object.entries(elements).map(([name, element]) => {
            const bounds = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return [name, {
                boxRight: bounds.right,
                contentRight: bounds.right - Number.parseFloat(style.paddingRight),
                textRight: rangeRight(element),
                display: style.display,
                width: style.width,
            }];
        }));
        return contentRights;
    });

    const textRights = Object.values(alignment).map((value) => value.textRight);
    expect(Math.max(...textRights) - Math.min(...textRights)).toBeLessThanOrEqual(1);
    expect(alignment.color.display).toBe('block');
    expect(alignment.related.display).toBe('block');
    expect(alignment.color.width).toBe(alignment.related.width);

    await page.setViewportSize({width: 390, height: 844});
    await page.reload();
    const narrowGeometry = await page.evaluate(() => {
        const theme = document.querySelector('#global_theme_toggle').getBoundingClientRect();
        const copyRights = [...document.querySelectorAll('.style-token-copy-button')]
            .map((button) => button.getBoundingClientRect().right);
        return {
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            maxThemeDelta: Math.max(...copyRights.map((right) => Math.abs(right - theme.right))),
        };
    });
    expect(narrowGeometry.documentOverflow).toBeLessThanOrEqual(1);
    expect(narrowGeometry.maxThemeDelta).toBeLessThanOrEqual(1);
});

test('exposes paired Light and Dark color tokens with live tuning controls', async ({page}) => {
    await page.goto('/settings/color-tokens');
    await page.evaluate(() => window.localStorage.removeItem('antigravity:color-token-overrides'));

    await expect(page.locator('[data-color-token-layout]')).toHaveCount(1);
    await expect(page.locator('.settings-nav-item-color-tokens')).toHaveCount(1);
    await expect(page.locator('[data-color-token-group-link="positive-green"]')).toHaveCount(1);
    await expect(page.locator('[data-color-token-group="positive-green"]')).toHaveCSS('border-radius', '10px');
    await expect(page.locator('[data-color-token-name="--theme-accent-positive"][data-color-token-mode="light"] [data-color-token-value]')).toHaveValue('#16a34a');
    await expect(page.locator('[data-color-token-name="--theme-accent-positive"][data-color-token-mode="dark"] [data-color-token-value]')).toHaveValue('#2fff9c');

    await page.evaluate(() => {
        document.documentElement.dataset.themeMode = 'light';
        document.documentElement.setAttribute('data-theme-override', 'light');
        window.dispatchEvent(new CustomEvent('antigravity:theme-mode-change', {detail: {mode: 'light'}}));
    });
    const lightValue = page.locator('[data-color-token-name="--theme-accent-positive"][data-color-token-mode="light"] [data-color-token-value]');
    await lightValue.fill('#123456');
    await expect(lightValue).toHaveValue('#123456');
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--theme-accent-positive').trim())).toBe('#123456');
    await page.locator('[data-color-token-name="--theme-accent-positive"][data-color-token-mode="light"] [data-color-token-reset]').click();
    await expect(lightValue).toHaveValue('#16a34a');
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--theme-accent-positive').trim())).toBe('');
});

test('hydrates the network self-check and uses the standard Settings action package layout', async ({page}) => {
    await page.route('**/api/settings/network-status*', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                rows: [
                    {
                        key: 'market',
                        status: 'Available',
                        note: 'Yahoo Finance is reachable, so missing price history can be refreshed from the network.',
                        checked_at_text: 'Last checked: 4 Aug 2026 12:15:00',
                        is_available: true,
                    },
                    {
                        key: 'logo',
                        status: 'Available',
                        note: 'Logo providers are reachable, so missing brand marks can be fetched when needed.',
                        checked_at_text: 'Last checked: 4 Aug 2026 12:15:00',
                        is_available: true,
                    },
                    {
                        key: 'google-hk',
                        status: 'Available',
                        note: 'Google (Hong Kong) is reachable from this device.',
                        checked_at_text: 'Last checked: 4 Aug 2026 12:15:00',
                        is_available: true,
                    },
                    {
                        key: 'sec',
                        status: 'Available',
                        note: 'SEC EDGAR is reachable.',
                        checked_at_text: 'Last checked: 4 Aug 2026 12:15:00',
                        is_available: true,
                    },
                    {
                        key: 'longbridge',
                        status: 'Available',
                        note: 'Longbridge transport is reachable.',
                        checked_at_text: 'Last checked: 4 Aug 2026 12:15:00',
                        is_available: true,
                    },
                    {
                        key: 'smtp',
                        status: 'Not configured',
                        note: 'SMTP credentials are not configured.',
                        checked_at_text: 'Last checked: 4 Aug 2026 12:15:00',
                        is_available: false,
                    },
                ],
                transport_note: 'Checks run from the application host. HTTP(S) proxy: configured; TLS trust: verified public/system roots; SMTP: direct TCP; account credentials are not submitted by this page.',
            }),
        });
    });

    await page.goto('/settings/network');

    const actionPackage = page.locator('main > div > section > section > section').filter({has: page.locator('[data-network-refresh-button]')});
    await expect(actionPackage).toHaveCount(1);
    await expect(actionPackage.locator('.settings-service-name')).toHaveText('Network self-check');
    await expect(actionPackage.locator('.settings-action-package-form')).toHaveCSS('justify-self', 'end');
    await expect(page.locator('[data-settings-service-row]')).toHaveCount(6);
    await expect(page.locator('[data-settings-service-row][data-service-key="market"] [data-settings-service-status]')).toHaveText('Available');
    await expect(page.locator('[data-settings-service-row][data-service-key="market"] [data-settings-service-note]')).toContainText('Yahoo Finance is reachable');
    await expect(page.locator('[data-settings-service-row][data-service-key="sec"] [data-settings-service-status]')).toHaveText('Available');
    await expect(page.locator('[data-settings-service-row][data-service-key="smtp"] [data-settings-service-status]')).toHaveText('Not configured');
    await expect(page.locator('[data-network-transport]')).toContainText('HTTP(S) proxy: configured');
    await expect(page.locator('[data-network-last-checked]')).toHaveText('Last checked: 4 Aug 2026 12:15:00');
});

test('redraws export-image preview charts immediately when sensitive values are masked', async ({page}) => {
    await page.goto('/settings/export-image');

    const demo = page.locator('[data-style-token-share-demo][data-style-token-share-preview-group="investment"]');
    const maskButton = demo.locator('[data-style-token-share-mask]');
    const previewCard = demo.locator('[data-style-token-share-preview-card]');
    const chart = demo.locator('[data-style-token-share-chart="overview"]');
    await expect(chart).toBeVisible();
    const visibleChart = await chart.evaluate((canvas) => canvas.toDataURL());

    await maskButton.click();

    await expect(maskButton).toHaveAttribute('aria-pressed', 'true');
    await expect(previewCard).toHaveClass(/is-share-sensitive-masked/);
    await expect.poll(() => chart.evaluate((canvas) => canvas.toDataURL())).not.toBe(visibleChart);
});

test('keeps Settings export tokens on detached Investment export targets', async ({page}) => {
    await page.goto('/settings/export-image');
    await page.evaluate(() => window.localStorage.removeItem('antigravity:export-image-config:v1'));
    await page.reload();

    const control = page.locator(
        '[data-export-image-shell] [data-style-token-control][data-style-token-name="--investment-community-share-card-gap"]',
    );
    const value = control.locator('[data-style-token-value-text]');
    await expect(control).toHaveCount(1);
    await expect(value).toHaveValue('10px');
    await value.click();
    await control.locator('[data-style-token-stepper="up"]').click();
    await expect(value).toHaveValue('11px');

    await page.goto('/trade/investment');
    const captureState = await page.evaluate(() => {
        const api = window.ANTIGRAVITY_EXPORT_IMAGE;
        const host = document.createElement('div');
        host.className = 'investment-community-share-capture';
        const card = document.createElement('article');
        card.className = 'investment-community-share-card';
        api.applyConfigToTargets([host, card], api.defaultProfileId);
        host.appendChild(card);
        document.body.appendChild(host);
        const rootStyles = window.getComputedStyle(document.documentElement);
        const cardStyles = window.getComputedStyle(card);
        const rect = host.getBoundingClientRect();
        const state = {
            storedGap: api.getConfig().tokens['--investment-community-share-card-gap'],
            rootGap: rootStyles.getPropertyValue('--investment-community-share-card-gap').trim(),
            cardGap: cardStyles.getPropertyValue('--investment-community-share-card-gap').trim(),
            logicalWidth: cardStyles.getPropertyValue('--investment-community-share-logical-width').trim(),
            logicalHeight: cardStyles.getPropertyValue('--investment-community-share-logical-height').trim(),
            hostWidth: Math.round(rect.width),
            hostHeight: Math.round(rect.height),
        };
        host.remove();
        return state;
    });

    expect(captureState).toMatchObject({
        storedGap: '11px',
        rootGap: '11px',
        cardGap: '11px',
        logicalWidth: '540px',
        logicalHeight: '865px',
        hostWidth: 1080,
        hostHeight: 1730,
    });
});

test('switches between return comparison and Ticker comparison workspaces', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=AAPL&period=1y');
    const chartRuntimeSources = await page.locator('script[src]').evaluateAll((scripts) => (
        scripts.map((script) => script.src).filter((source) => source.includes('/vendor/chart/'))
    ));
    expect(chartRuntimeSources).toHaveLength(4);
    expect(chartRuntimeSources.every((source) => new URL(source).pathname.startsWith('/static/assets/js/vendor/chart/'))).toBe(true);
    await expect(page.locator('.workspace-nav-item-compare')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#app_sidebar .workspace-mode-nav > a')).toHaveCount(4);
    await expect(page.locator('#app_sidebar a[href="/workspaces/dca"]')).toHaveCount(0);

    const readWorkspaceHeadingLayout = () => page.evaluate(() => {
        const title = document.querySelector('.workspace-mode-title-card .report-heading').getBoundingClientRect();
        const result = document.querySelector('.workspace-mode-main .workspace-summary-card .report-heading').getBoundingClientRect();
        const sidebarTitle = document.querySelector('#app_sidebar .hero h1').getBoundingClientRect();
        const toggle = document.querySelector('#sidebar_toggle').getBoundingClientRect();
        const theme = document.querySelector('#global_theme_toggle').getBoundingClientRect();
        const controls = document.querySelector('.workspace-mode-controls-surface').getBoundingClientRect();
        const main = document.querySelector('.workspace-mode-main').getBoundingClientRect();
        const centerY = (rect) => rect.top + (rect.height / 2);
        return {
            titleCenterDelta: Math.abs(centerY(title) - centerY(toggle)),
            resultCenterDelta: Math.abs(centerY(result) - centerY(theme)),
            sidebarCenterDelta: Math.abs(centerY(sidebarTitle) - centerY(toggle)),
            bottomDelta: Math.abs(controls.bottom - main.bottom),
            controlsTop: controls.top,
        };
    });
    const compareHeadingLayout = await readWorkspaceHeadingLayout();
    expect(compareHeadingLayout.titleCenterDelta).toBeLessThanOrEqual(1);
    expect(compareHeadingLayout.resultCenterDelta).toBeLessThanOrEqual(1);
    expect(compareHeadingLayout.sidebarCenterDelta).toBeLessThanOrEqual(1);
    expect(compareHeadingLayout.bottomDelta).toBeLessThanOrEqual(1);
    expect(compareHeadingLayout.controlsTop).toBeLessThanOrEqual(64);

    await page.getByRole('link', {name: 'Ticker comparison'}).click();
    await expect(page).toHaveURL(/\/workspaces\/prices/);
    await expect(page.locator('.workspace-nav-item-prices')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.workspace-mode-title-card')).toContainText('Price performance');
    await expect(page.getByRole('heading', {name: 'Price performance', exact: true, level: 2})).toBeVisible();
    await expect(page.getByRole('heading', {name: 'Price history', exact: true, level: 2})).toBeVisible();
    await expect(page.locator('.price-compare-workspace')).toHaveAttribute('aria-labelledby', 'ticker_comparison_heading');
    await expect(page.locator('.workspace-mode-controls-surface')).toHaveAttribute('aria-labelledby', 'ticker_comparison_heading');
    await expect(page.locator('.workspace-mode-main')).toHaveAttribute('aria-labelledby', 'price_history_heading');
    const priceResultArticle = page.locator('xpath=/html/body/main/div/section/section/div/section/div/article');
    await expect(priceResultArticle).toHaveCount(1);
    await expect(priceResultArticle.locator('.price-compare-range')).toHaveCount(1);
    await expect(page.locator('xpath=/html/body/main/div/section/section/div/section/div/header/div/span')).toHaveCount(0);

    const aaplLogo = page.locator('.ticker-input-control:has(input[value="AAPL"]) .ticker-input-logo');
    const aaplLogoState = async () => aaplLogo.evaluate((logo) => {
        const slot = logo.closest('.ticker-leading-slot');
        return {
            imageBorderRadius: getComputedStyle(logo).borderRadius,
            imageObjectFit: getComputedStyle(logo).objectFit,
            slotOverflow: getComputedStyle(slot).overflow,
        };
    });
    const expectedAaplLogoState = {
        imageBorderRadius: '0px',
        imageObjectFit: 'contain',
        slotOverflow: 'visible',
    };
    await expect(aaplLogo).toBeVisible();
    expect(await aaplLogoState()).toEqual(expectedAaplLogoState);

    const priceHeadingLayout = await readWorkspaceHeadingLayout();
    expect(priceHeadingLayout.titleCenterDelta).toBeLessThanOrEqual(1);
    expect(priceHeadingLayout.resultCenterDelta).toBeLessThanOrEqual(1);
    expect(priceHeadingLayout.sidebarCenterDelta).toBeLessThanOrEqual(1);
    expect(priceHeadingLayout.bottomDelta).toBeLessThanOrEqual(1);
    expect(priceHeadingLayout.controlsTop).toBeLessThanOrEqual(64);

    const priceRangeGeometry = await page.evaluate(() => {
        const heading = document.querySelector('.workspace-mode-main .report-heading').getBoundingClientRect();
        const range = document.querySelector('.price-compare-range').getBoundingClientRect();
        const modeCard = document.querySelector('.workspace-mode-title-card').getBoundingClientRect();
        const controls = document.querySelector('.workspace-mode-controls-surface').getBoundingClientRect();
        const resultCard = document.querySelector('.workspace-mode-main .workspace-summary-card').getBoundingClientRect();
        const main = document.querySelector('.workspace-mode-main').getBoundingClientRect();
        return {
            leftDelta: Math.abs(heading.left - range.left),
            verticalGap: range.top - heading.bottom,
            modeColumnDelta: Math.abs(modeCard.right - controls.right),
            resultColumnDelta: Math.abs(resultCard.left - main.left),
            titleColumnGap: resultCard.left - modeCard.right,
        };
    });
    expect(priceRangeGeometry.leftDelta).toBeLessThanOrEqual(1);
    expect(priceRangeGeometry.verticalGap).toBeGreaterThanOrEqual(1);
    expect(priceRangeGeometry.modeColumnDelta).toBeLessThanOrEqual(1);
    expect(priceRangeGeometry.resultColumnDelta).toBeLessThanOrEqual(1);
    expect(priceRangeGeometry.titleColumnGap).toBeGreaterThanOrEqual(11);

    await page.locator('#global_theme_toggle').click();
    expect(await aaplLogoState()).toEqual(expectedAaplLogoState);
    await page.locator('#global_theme_toggle').click();
});

test('keeps the merged DCA strategy out of the optimistic workspace sidebar', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=AAPL&ticker=MSFT');

    const navigationState = await page.evaluate(() => {
        const rendered = window.ANTIGRAVITY_BOOTSTRAP.renderOptimisticNavigationSkeleton({view: 'backtest'});
        const sidebar = document.querySelector('#app_sidebar');
        return {
            rendered,
            labels: [...sidebar.querySelectorAll('.navigation-skeleton-sidebar-nav .settings-nav-label')]
                .map((node) => node.textContent.trim()),
            hasDcaLabel: sidebar.textContent.includes('Dollar-cost averaging'),
        };
    });

    expect(navigationState).toEqual({
        rendered: true,
        labels: ['Return comparison', 'Ticker comparison', 'Compute your portfolio', 'Backtest'],
        hasDcaLabel: false,
    });
});

test('anchors the comparison share control to the summary panel without overlapping the theme control', async ({page}) => {
    await page.addInitScript(() => {
        window.sessionStorage.setItem('antigravity:sidebar-open', 'false');
    });
    await page.setViewportSize({width: 810, height: 834});
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=AAPL&ticker=MU&period=1y');

    const shareButton = page.locator('#export_transactions_button');
    await expect(shareButton).toBeVisible();

    const geometry = await page.evaluate(() => {
        const button = document.querySelector('#export_transactions_button');
        const drawer = button?.closest('[data-share-drawer="tickers"]');
        const panel = document.querySelector('#compare_summary_panel');
        const chartSurface = document.querySelector('.workspace-mode-main > .workspace-header > .chart-surface');
        const theme = document.querySelector('#global_theme_toggle');
        const rect = (element) => element?.getBoundingClientRect();
        const share = rect(button);
        const panelRect = rect(panel);
        const chartSurfaceRect = rect(chartSurface);
        const themeRect = rect(theme);
        const overlaps = share && themeRect
            ? share.left < themeRect.right
                && share.right > themeRect.left
                && share.top < themeRect.bottom
                && share.bottom > themeRect.top
            : null;
        const centerY = (box) => box.top + (box.height / 2);

        return {
            drawerIsDirectPanelChild: drawer?.parentElement === panel,
            themeCenterDelta: share && themeRect ? Math.abs(centerY(share) - centerY(themeRect)) : null,
            overlapsTheme: overlaps,
            shareRight: share?.right,
            themeLeft: themeRect?.left,
            summaryWidthDelta: panelRect && chartSurfaceRect
                ? Math.abs(panelRect.width - chartSurfaceRect.width)
                : null,
        };
    });

    expect(geometry.drawerIsDirectPanelChild).toBe(true);
    expect(geometry.themeCenterDelta).toBeLessThanOrEqual(1);
    expect(geometry.overlapsTheme).toBe(false);
    expect(geometry.shareRight).toBeLessThan(geometry.themeLeft);
    expect(geometry.summaryWidthDelta).toBeLessThanOrEqual(0.01);
});

test('stacks the portfolio date beneath the aligned summary title', async ({page}) => {
    await page.setViewportSize({width: 1_024, height: 768});
    await page.goto('/workspaces/portfolio?ticker=QQQ&ticker=AAPL&weight=60&weight=40&period=1y');

    const range = page.locator('.portfolio-summary-range');
    await expect(range).toBeVisible();
    await expect(range).not.toHaveText('');

    const geometry = await page.evaluate(() => {
        const sidebarTitle = document.querySelector('#app_sidebar .hero h1').getBoundingClientRect();
        const modeTitle = document.querySelector('.workspace-mode-title-card .report-heading').getBoundingClientRect();
        const summaryTitle = document.querySelector('.workspace-mode-main .report-heading').getBoundingClientRect();
        const summaryRange = document.querySelector('.portfolio-summary-range').getBoundingClientRect();
        const toggle = document.querySelector('#sidebar_toggle').getBoundingClientRect();
        const theme = document.querySelector('#global_theme_toggle').getBoundingClientRect();
        const centerY = (rect) => rect.top + (rect.height / 2);
        return {
            sidebarCenterDelta: Math.abs(centerY(sidebarTitle) - centerY(toggle)),
            modeCenterDelta: Math.abs(centerY(modeTitle) - centerY(toggle)),
            summaryCenterDelta: Math.abs(centerY(summaryTitle) - centerY(theme)),
            rangeLeftDelta: Math.abs(summaryRange.left - summaryTitle.left),
            rangeVerticalGap: summaryRange.top - summaryTitle.bottom,
        };
    });

    expect(geometry.sidebarCenterDelta).toBeLessThanOrEqual(1);
    expect(geometry.modeCenterDelta).toBeLessThanOrEqual(1);
    expect(geometry.summaryCenterDelta).toBeLessThanOrEqual(1);
    expect(geometry.rangeLeftDelta).toBeLessThanOrEqual(1);
    expect(geometry.rangeVerticalGap).toBeGreaterThanOrEqual(1);
});

test('matches the shared Compare Period dropdown width to its trigger', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=AAPL&period=1y');
    const periodTrigger = page.locator('#period_panel [data-shared-select-trigger]');
    const periodDropdown = page.locator('#period_dropdown');

    await periodTrigger.click();
    await expect(periodDropdown).toBeVisible();

    const readWidthDelta = () => page.evaluate(() => {
        const trigger = document.querySelector('#period_panel [data-shared-select-trigger]');
        const dropdown = document.querySelector('#period_dropdown');
        if (!(trigger instanceof HTMLElement) || !(dropdown instanceof HTMLElement)) return Number.POSITIVE_INFINITY;
        return Math.abs(trigger.getBoundingClientRect().width - dropdown.getBoundingClientRect().width);
    });
    await expect.poll(readWidthDelta).toBeLessThan(0.01);

    const widths = await page.evaluate(() => ({
        trigger: document.querySelector('#period_panel [data-shared-select-trigger]')?.getBoundingClientRect().width,
        dropdown: document.querySelector('#period_dropdown')?.getBoundingClientRect().width,
    }));
    expect(widths.dropdown).toBeCloseTo(widths.trigger, 5);
});

test('remembers return and Ticker comparison state while switching workspaces', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=AAPL&period=1y');
    await page.getByRole('link', {name: 'Ticker comparison'}).click();
    await expect(page).toHaveURL(/\/workspaces\/prices\?ticker=QQQ&ticker=AAPL$/);

    await page.goto('/workspaces/prices?ticker=DRAM&ticker=MU&ticker=STX&period=5y');
    await page.getByRole('link', {name: 'Return comparison'}).click();
    await expect(page).toHaveURL(/\/workspaces\/compare\?ticker=QQQ&ticker=AAPL$/);

    await page.getByRole('link', {name: 'Ticker comparison'}).click();
    await expect(page).toHaveURL(/\/workspaces\/prices\?ticker=DRAM&ticker=MU&ticker=STX&range=5y$/);
});

test('renders cross-market one-day returns as visible lines', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=AAPL&period=1y');
    await page.waitForFunction(() => Boolean(window.Chart?.getChart?.(document.querySelector('#returnsChart'))));

    const renderState = await page.evaluate(() => {
        history.replaceState({}, '', '/workspaces/compare?ticker=0005.HK&ticker=HSBA.L&ticker=HSBC&period=1d');
        const dates = ['09:30', '10:30', '11:30', '12:30'];
        const rawDates = [
            '2026-07-09 21:30',
            '2026-07-10 03:30',
            '2026-07-10 09:30',
            '2026-07-10 10:30',
        ];
        const tickers = ['5.HK', 'HSBA.L', 'HSBC'];
        window.ANTIGRAVITY_APP.chart = {
            profiles: tickers.map((ticker) => ({ticker, company_name: ticker, logo_url: null})),
            series: tickers.map((ticker, index) => ({
                ticker,
                dates,
                raw_dates: rawDates,
                normalized_returns: [index, index + 0.5, index + 1, index + 1.5],
                candlestick_returns: dates.map((_, candleIndex) => ({
                    x: candleIndex,
                    o: index + candleIndex,
                    h: index + candleIndex + 0.75,
                    l: index + candleIndex - 0.25,
                    c: index + candleIndex + 0.5,
                })),
                color: ['#0055cc', '#7f42af', '#ff2f92'][index],
                glow: true,
            })),
            tradingDate: '2026-07-10',
        };
        window.ANTIGRAVITY_BOOTSTRAP.initChartWorkspace();
        const canvas = document.querySelector('#returnsChart');
        const chart = window.Chart.getChart(canvas);
        return {
            mode: canvas.dataset.chartRenderMode,
            datasets: chart.data.datasets.map((dataset) => ({
                showLine: dataset.showLine,
                finiteValues: dataset.data.filter((value) => Number.isFinite(value)).length,
            })),
        };
    });

    expect(renderState.mode).toBe('line');
    expect(renderState.datasets).toHaveLength(3);
    expect(renderState.datasets.every((dataset) => dataset.showLine && dataset.finiteValues === 4)).toBe(true);
});

test('commits and loads a clicked ticker suggestion', async ({page}) => {
    await page.route('**/api/symbol-search?q=D*', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify([
                {
                    symbol: 'DRAM',
                    name: 'Roundhill Memory ETF',
                    logo_url: '/api/market-store/logos/DRAM.png',
                    source: 'local',
                },
            ]),
        });
    });
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=1y');
    const input = page.locator('#ticker_1');
    await input.fill('D');
    await page.locator('#ticker_1_suggestions .suggestion-item', {hasText: 'DRAM'}).click();

    await expect(page).toHaveURL(/ticker=DRAM/);
    await expect(page.locator('#ticker_1')).toHaveValue('DRAM');
});

test('keeps a valid ticker lookup visible with fetching feedback', async ({page}) => {
    let releaseLookup;
    const lookupGate = new Promise((resolve) => {
        releaseLookup = resolve;
    });
    await page.route('**/api/symbol-search?q=spy*', async (route) => {
        await lookupGate;
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify([{
                symbol: 'SPY',
                name: 'SPDR S&P 500 ETF Trust',
                logo_url: '/api/market-store/logos/SPY.png',
                source: 'remote',
            }]),
        });
    });
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=1d');

    await page.locator('#ticker_2').fill('spy');
    const status = page.locator('#ticker_2_suggestions .suggestion-loading');
    await expect(status).toHaveText('Fetching SPY…');

    releaseLookup();
    await expect(status).toBeHidden();
});

test('keeps prefix and exact ticker suggestions open until selection or Enter', async ({page}) => {
    const appleSuggestion = {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        logo_url: '/market-store/logos/AAPL.svg',
        source: 'local',
    };
    await page.route('**/api/symbol-search?q=AA*', async (route) => {
        const query = new URL(route.request().url()).searchParams.get('q');
        const payload = query === 'AA'
            ? [{symbol: 'AA', name: 'Alcoa Corporation', source: 'remote'}, appleSuggestion]
            : query === 'AAP'
                ? [{symbol: 'AAP', name: 'Advance Auto Parts, Inc.', source: 'remote'}, appleSuggestion]
                : [appleSuggestion];
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(payload),
        });
    });
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=1y');
    const input = page.locator('#ticker_1');
    const appleItem = page.locator('#ticker_1_suggestions .suggestion-item[data-symbol="AAPL"]');

    await input.fill('AA');
    await expect(appleItem).toBeVisible();

    await input.fill('AAP');
    await expect(appleItem).toBeVisible();

    const urlBeforeExactInput = page.url();
    await input.fill('AAPL');
    await expect(appleItem).toBeVisible();
    await expect(appleItem).toContainText('Apple Inc.');
    const appleLogo = appleItem.locator('img.suggestion-logo');
    await expect(appleLogo).toHaveCount(1);
    await expect(appleLogo).toHaveAttribute('src', '/market-store/logos/AAPL.svg');
    await page.waitForTimeout(150);
    expect(page.url()).toBe(urlBeforeExactInput);

    await input.press('Enter');
    await expect(page).toHaveURL(/ticker=AAPL/, {timeout: 10_000});
});

test('draws no return zero baseline for a market-cap chart', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=6mo');

    const chartState = await page.evaluate(() => {
        const state = window.ANTIGRAVITY_APP;
        state.currentView = 'prices';
        state.comparisonMetric = 'market-cap';
        state.chart = {
            ...state.chart,
            profiles: [],
            series: [{
                ticker: 'QQQ',
                dates: ['1 Jan 2026', '2 Jan 2026'],
                raw_dates: ['2026-01-01 00:00', '2026-01-02 00:00'],
                normalized_returns: [0, 1],
                market_caps: [100_000_000_000, 120_000_000_000],
                color: '#0055cc',
            }],
        };
        window.ANTIGRAVITY_BOOTSTRAP.initChartWorkspace();
        const chart = window.Chart.getChart(document.querySelector('#returnsChart'));
        const zeroBandPlugin = chart.config._config.plugins.find((plugin) => plugin.id === 'zeroBandPlugin');
        const calls = [];
        zeroBandPlugin.beforeDatasetsDraw({
            ctx: {
                save: () => calls.push('save'),
                beginPath: () => calls.push('beginPath'),
                moveTo: () => calls.push('moveTo'),
                lineTo: () => calls.push('lineTo'),
                stroke: () => calls.push('stroke'),
                restore: () => calls.push('restore'),
            },
            chartArea: {left: 0, right: 100},
            scales: {y: {getPixelForValue: () => 50}},
        });
        return {
            zeroBandCalls: calls,
            xBorderVisible: chart.options.scales.x.border.display,
        };
    });

    expect(chartState.zeroBandCalls).toEqual([]);
    expect(chartState.xBorderVisible).toBe(false);
});

test('formats market-cap y-axis values without fixed trailing zeroes', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=6mo');
    await page.waitForFunction(() => Boolean(window.Chart?.getChart?.(document.querySelector('#returnsChart'))));

    const formattedTicks = await page.evaluate(() => {
        const state = window.ANTIGRAVITY_APP;
        state.currentView = 'prices';
        state.comparisonMetric = 'market-cap';
        state.chart = {
            ...state.chart,
            profiles: [],
            series: [{
                ticker: 'QQQ',
                dates: ['1 Jan 2026', '2 Jan 2026'],
                raw_dates: ['2026-01-01 00:00', '2026-01-02 00:00'],
                normalized_returns: [0, 1],
                market_caps: [1_234, 4_500_000_000_000],
                color: '#0055cc',
            }],
        };
        window.ANTIGRAVITY_BOOTSTRAP.initChartWorkspace();
        const chart = window.Chart.getChart(document.querySelector('#returnsChart'));
        const callback = chart.options.scales.y.ticks.callback;
        const ticks = [{value: 1_000}, {value: 1_234}, {value: 1_500}];
        return [
            callback(1_234, 1, ticks),
            callback(4_500_000_000_000, 1, ticks),
            callback(4_000_000_000_000, 1, ticks),
        ];
    });

    expect(formattedTicks).toEqual(['1,234', '4.5T', '4T']);
});

test('omits midnight from long market-cap x-axis labels', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=6mo');

    const axisLabels = await page.evaluate(() => {
        const state = window.ANTIGRAVITY_APP;
        const rawDates = Array.from({length: 10}, (_, index) => `2026-01-${String(index + 1).padStart(2, '0')} 00:00`);
        const series = {
            ticker: 'QQQ',
            dates: rawDates,
            raw_dates: rawDates,
            normalized_returns: rawDates.map((_value, index) => index),
            market_caps: rawDates.map((_value, index) => 100_000_000_000 + (index * 1_000_000_000)),
            color: '#0055cc',
        };
        const renderAxisLabels = (period) => {
            window.history.replaceState({}, '', `/workspaces/prices?metric=market-cap&ticker=QQQ&ticker=JEPQ&period=${period}`);
            state.currentView = 'prices';
            state.comparisonMetric = 'market-cap';
            state.chart = {...state.chart, profiles: [], series: [series]};
            window.ANTIGRAVITY_BOOTSTRAP.initChartWorkspace();
            const canvas = document.querySelector('#returnsChart');
            const chart = window.Chart.getChart(canvas);
            const plugin = chart.config._config.plugins.find((item) => item.id === 'xAxisLabelPlugin');
            const calls = [];
            plugin.afterDraw({
                ctx: {
                    save: () => {},
                    restore: () => {},
                    fillText: (text) => calls.push(String(text)),
                },
                chartArea: {bottom: 200, left: 0, width: 400},
                scales: {x: {getPixelForValue: (value) => Number(value) * 40}},
            });
            return calls;
        };
        return {
            oneWeekRange: renderAxisLabels('1w'),
            longRange: renderAxisLabels('6mo'),
            shortRange: renderAxisLabels('3d'),
        };
    });

    expect(axisLabels.oneWeekRange).not.toContain('2026 00:00');
    expect(axisLabels.longRange).not.toContain('2026 00:00');
    expect(axisLabels.longRange).toContain('2026');
    expect(axisLabels.shortRange).toContain('2026 00:00');
});

test('keeps an inferred numeric market symbol as a user-confirmed suggestion', async ({page}) => {
    await page.route('**/api/symbol-search?q=660*', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify([
                {
                    symbol: '000660.KS',
                    name: 'SK hynix Inc.',
                    logo_url: '/market-store/logos/000660.KS.svg',
                    source: 'local',
                },
            ]),
        });
    });
    await page.goto('/workspaces/prices?ticker=QQQ&ticker=AAPL&period=5y');
    const input = page.locator('#ticker_1');
    await input.fill('660');

    const suggestion = page.locator('#ticker_1_suggestions .suggestion-item', {hasText: '000660.KS'});
    await expect(input).toHaveValue('660');
    await expect(suggestion).toBeVisible();
    await expect(page).toHaveURL(/ticker=QQQ/);

    await suggestion.click();
    await expect(page).toHaveURL(/ticker=000660\.KS/, {timeout: 10_000});
    await expect(page.locator('#ticker_1')).toHaveValue('000660.KS');
});

test('keeps exact-date pickers inside the viewport and clickable', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=QQQ&ticker=AAPL&period=1d');
    await page.locator('form.controls').evaluate((form) => {
        form.addEventListener('submit', (event) => event.preventDefault(), {capture: true});
    });
    await page.locator('.range-mode-shell label[for="range_exact"]').click();
    await page.getByRole('textbox', {name: 'Type trading date'}).click();

    const popover = page.locator('.date-picker-popover:not([hidden])');
    await expect(popover).toBeVisible();
    const geometry = await popover.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
            top: rect.top,
            bottom: rect.bottom,
            viewportHeight: window.visualViewport?.height || window.innerHeight,
        };
    });
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);

    const modeOverlap = await page.locator('.range-mode-shell').evaluate((modeShell, visiblePopover) => {
        const modeRect = modeShell.getBoundingClientRect();
        const popoverRect = visiblePopover.getBoundingClientRect();
        return !(
            popoverRect.right <= modeRect.left
            || popoverRect.left >= modeRect.right
            || popoverRect.bottom <= modeRect.top
            || popoverRect.top >= modeRect.bottom
        );
    }, await popover.elementHandle());
    expect(modeOverlap).toBe(false);
    await page.locator('.range-mode-shell label[for="range_period"]').click();
    await expect(page.locator('#range_period')).toBeChecked();
    await expect(popover).toBeHidden();
    await page.locator('.range-mode-shell label[for="range_exact"]').click();
    await page.getByRole('textbox', {name: 'Type trading date'}).click();
    await expect(popover).toBeVisible();

    await page.locator('.price-subplots-surface').click({position: {x: 12, y: 12}});
    await expect(popover).toBeHidden();
    await page.getByRole('textbox', {name: 'Type trading date'}).click();
    await expect(popover).toBeVisible();

    const selectedValue = await page.locator('#exact_trading_date').inputValue();
    const dateButton = popover.locator(`.date-picker-day[data-value="${selectedValue}"]`);
    await expect(dateButton).toHaveAttribute('data-selectable', 'true');
    await dateButton.click();
    await expect(popover).toBeHidden();
    await expect(page.locator('#exact_trading_date')).toHaveValue(selectedValue);
});

test('renders Compare exact-date values at regular weight', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&range=exact&from=2025-08-14&to=2026-08-14');
    await expect(page.locator('#exact_panel')).toBeVisible();

    const weights = await page.locator('#exact_panel [data-exact-range-date-grid]:not([hidden]) [data-date-trigger-value]').evaluateAll((values) => (
        values.map((value) => getComputedStyle(value).fontWeight)
    ));
    expect(weights).toEqual(['400', '400']);
});

test('switches an untouched range mode without submitting or desynchronizing its pill', async ({page}) => {
    await page.goto('/workspaces/prices?metric=market-cap&ticker=AAPL&ticker=NVDA&period=1d');
    const rangeShell = page.locator('.range-mode-shell');
    const form = page.locator('form.controls');
    await form.evaluate((element) => {
        element.dataset.rangeModeSubmitCount = '0';
        element.addEventListener('submit', (event) => {
            event.preventDefault();
            element.dataset.rangeModeSubmitCount = String(
                Number.parseInt(element.dataset.rangeModeSubmitCount || '0', 10) + 1,
            );
        }, {capture: true});
    });
    const urlBeforeToggle = page.url();

    await rangeShell.locator('label[for="range_exact"]').click();
    await expect(page.locator('#range_exact')).toBeChecked();
    await expect(rangeShell).toHaveAttribute('data-active', 'exact');
    await expect(page.locator('#exact_panel')).toBeVisible();

    await rangeShell.locator('label[for="range_period"]').click();
    await expect(page.locator('#range_period')).toBeChecked();
    await expect(rangeShell).toHaveAttribute('data-active', 'period');
    await expect(page.locator('#period_panel')).toBeVisible();
    await page.waitForTimeout(350);

    expect(page.url()).toBe(urlBeforeToggle);
    await expect.poll(() => form.evaluate((element) => element.dataset.rangeModeSubmitCount)).toBe('0');
    const pillState = await rangeShell.evaluate((element) => ({
        activeIndex: element.style.getPropertyValue('--segmented-active-index'),
        overflow: element.dataset.segmentedOverflow,
        activeLabelColor: getComputedStyle(element.querySelector('.segmented-control-option:first-child span')).color,
        inactiveLabelColor: getComputedStyle(element.querySelector('.segmented-control-option:last-child span')).color,
    }));
    expect(pillState.activeIndex).toBe('0');
    expect(pillState.overflow).toBe('0');
    expect(pillState.activeLabelColor).not.toBe(pillState.inactiveLabelColor);
});

test('pre-fills Exact with the rendered multi-day market-cap range', async ({page}) => {
    await page.goto('/workspaces/prices?metric=market-cap&ticker=AAPL&ticker=NVDA&period=6mo');
    await page.locator('form.controls').evaluate((form) => {
        form.addEventListener('submit', (event) => event.preventDefault(), {capture: true});
    });
    const expectedRange = await page.evaluate(() => {
        const dates = window.ANTIGRAVITY_APP.chart.series[0].raw_dates;
        return {
            start: String(dates[0]).slice(0, 10),
            end: String(dates[dates.length - 1]).slice(0, 10),
        };
    });

    await page.locator('.range-mode-shell label[for="range_exact"]').click();

    await expect(page.locator('#exact_start')).toHaveValue(expectedRange.start);
    await expect(page.locator('#exact_end')).toHaveValue(expectedRange.end);
    expect(expectedRange.start).not.toBe(expectedRange.end);
});

test('retains rendered exact-date labels after a market-cap page reload', async ({page}) => {
    const exactUrl = '/workspaces/prices?metric=market-cap&ticker=AAPL&ticker=NVDA&range=exact&period=6mo&from=2026-01-20&to=2026-07-24';

    await page.goto(exactUrl);
    const startEditor = page.getByRole('textbox', {name: 'Type start date'});
    const endEditor = page.getByRole('textbox', {name: 'Type end date'});
    const initialValues = {
        start: await page.locator('#exact_start').inputValue(),
        end: await page.locator('#exact_end').inputValue(),
        startLabel: await startEditor.textContent(),
        endLabel: await endEditor.textContent(),
    };
    const expectedLabels = await page.evaluate(() => {
        const formatDate = (inputId) => {
            const [year, month, day] = String(document.querySelector(inputId)?.value || '')
                .split('-')
                .map((value) => Number.parseInt(value, 10));
            return window.ANTIGRAVITY_BOOTSTRAP.dateDisplay.formatFullDateParts({
                year,
                monthIndex: month - 1,
                day,
            });
        };
        return {
            start: formatDate('#exact_start'),
            end: formatDate('#exact_end'),
        };
    });
    expect(initialValues.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(initialValues.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(initialValues.startLabel).toBe(expectedLabels.start);
    expect(initialValues.endLabel).toBe(expectedLabels.end);

    await page.reload();
    await expect(page.locator('#exact_start')).toHaveValue(initialValues.start);
    await expect(page.locator('#exact_end')).toHaveValue(initialValues.end);
    await expect(startEditor).toHaveText(initialValues.startLabel || '');
    await expect(endEditor).toHaveText(initialValues.endLabel || '');
});

test('submits a selected custom Period option for market-cap comparison', async ({page}) => {
    await page.goto('/workspaces/prices?metric=market-cap&ticker=AAPL&ticker=NVDA&period=1w');
    const periodTrigger = page.locator('[data-shared-select-trigger]');
    await periodTrigger.click();
    const periodListbox = page.getByRole('listbox', {name: 'Period', exact: true});
    await Promise.all([
        page.waitForURL((url) => url.searchParams.get('range') === '2y'),
        periodListbox.getByRole('option', {name: '2 years', exact: true}).click(),
    ]);

    await expect(page.locator('#period')).toHaveValue('2y');
    await expect(page.getByRole('button', {name: 'Period: 2 years', exact: true})).toBeVisible();
    await page.locator('#add_ticker').click();
    await expect(page.locator('#ticker_3')).toBeVisible();
});

test('switches exact-date pickers into a bounded year grid with explanatory disabled months', async ({page}) => {
    await page.route('**/api/date-constraints*', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                min_date: '2022-05-23',
                max_date: '2026-07-14',
                trading_dates: ['2022-05-23', '2022-05-24', '2026-07-14'],
                adjusted_start: '2026-07-14',
                adjusted_end: '2026-07-14',
                message: null,
                availability: {
                    earliest: {message: 'JEPQ has no comparable history before 23 May 2022.'},
                    latest: {message: 'AAPL has no comparable history after 14 Jul 2026.'},
                },
            }),
        });
    });
    await page.goto('/workspaces/prices?ticker=QQQ&ticker=AAPL&period=1d');
    await page.locator('form.controls').evaluate((form) => {
        form.addEventListener('submit', (event) => event.preventDefault(), {capture: true});
    });
    await page.locator('.range-mode-shell label[for="range_exact"]').click();
    const input = page.locator('#exact_trading_date');
    await expect.poll(() => input.evaluate((element) => element.min)).toBe('2022-05-23');
    await page.getByRole('textbox', {name: 'Type trading date'}).click();
    await page.locator('.date-picker-popover:not([hidden]) [data-date-title]').click();

    const monthGrid = page.locator('[data-date-month-grid]:not([hidden])');
    await expect(monthGrid).toBeVisible();
    await expect(monthGrid.locator('.date-picker-month')).toHaveCount(12);
    await expect(monthGrid.locator('[data-month-value="2026-08"]')).toHaveAttribute('data-selectable', 'false');
    const popover = page.locator('.date-picker-popover:not([hidden])');
    await popover.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()));
    const heightBeforeFeedback = await popover.evaluate((element) => element.getBoundingClientRect().height);
    await monthGrid.locator('[data-month-value="2026-08"]').click();
    await expect(page.locator('#exact_trading_date_feedback')).toContainText('AAPL has no comparable history after 14 Jul 2026.');
    await expect.poll(() => popover.evaluate((element) => element.getBoundingClientRect().height)).toBe(heightBeforeFeedback);

    for (let index = 0; index < 4; index += 1) {
        await page.getByRole('button', {name: 'Previous year'}).click();
    }
    await expect(monthGrid.locator('[data-month-value="2022-04"]')).toHaveAttribute('data-selectable', 'false');
    await expect(monthGrid.locator('[data-month-value="2022-05"]')).toHaveAttribute('data-selectable', 'true');
    await monthGrid.locator('[data-month-value="2022-04"]').click();
    await expect(page.locator('#exact_trading_date_feedback')).toContainText('JEPQ has no comparable history before 23 May 2022.');
    await monthGrid.locator('[data-month-value="2022-05"]').click();
    await expect(page.locator('.date-picker-popover:not([hidden]) [data-date-calendar]:not([hidden])')).toBeVisible();
});

test('allows the current US premarket date for an exact one-day comparison', async ({page}) => {
    await page.route('**/api/date-constraints*', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                min_date: '2026-04-15',
                max_date: '2026-08-24',
                trading_dates: ['2026-04-15', '2026-08-21', '2026-08-24'],
                adjusted_start: '2026-08-24',
                adjusted_end: '2026-08-24',
                message: null,
                availability: {
                    latest: {message: 'Current US session data is available for the selected tickers.'},
                },
            }),
        });
    });
    await page.goto('/workspaces/prices?ticker=AAPL&ticker=MSFT&range=exact&period=1d&date=2026-08-24');

    const input = page.locator('#exact_trading_date');
    await expect.poll(() => input.inputValue()).toBe('2026-08-24');
    await expect.poll(() => input.evaluate((element) => element.max)).toBe('2026-08-24');
    await page.getByRole('textbox', {name: 'Type trading date'}).click();
    await page.locator('.date-picker-popover:not([hidden]) [data-date-title]').click();
    const monthGrid = page.locator('[data-date-month-grid]:not([hidden])');
    await expect(monthGrid.locator('[data-month-value="2026-08"]')).toHaveAttribute('data-selectable', 'true');
    await monthGrid.locator('[data-month-value="2026-08"]').click();
    await expect(
        page.locator('.date-picker-popover:not([hidden]) [data-date-calendar]:not([hidden]) [data-value="2026-08-24"]'),
    ).toHaveAttribute('data-selectable', 'true');
});

test('keeps manual date drafts neutral and reserves feedback for complete unavailable dates', async ({page}) => {
    await page.route('**/api/date-constraints*', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                min_date: '2025-07-01',
                max_date: '2025-07-31',
                trading_dates: ['2025-07-03', '2025-07-07', '2025-07-17', '2025-07-18', '2025-07-21', '2025-07-29'],
                adjusted_start: '2025-07-17',
                adjusted_end: '2025-07-29',
                message: null,
                availability: {},
            }),
        });
    });
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=AAPL&range=exact&period=1y&from=2025-07-17&to=2025-07-29');
    await page.locator('form.controls').evaluate((form) => {
        form.addEventListener('submit', (event) => event.preventDefault(), {capture: true});
    });

    const editor = page.getByRole('textbox', {name: 'Type start date'});
    await editor.click();
    await editor.press('ControlOrMeta+A');
    await editor.press('Backspace');
    for (const character of '17 Jul 2025') {
        await editor.pressSequentially(character);
        await expect(editor).toHaveAttribute('aria-invalid', 'false');
    }
    await expect(page.locator('#exact_start_feedback')).toBeEmpty();

    await editor.press('ControlOrMeta+A');
    await editor.pressSequentially('4 Jul 2025');
    await expect(editor).toHaveAttribute('aria-invalid', 'false');
    await expect(page.locator('#exact_start_feedback')).toContainText('Choose a shared trading day for the selected tickers.');
});

test('keeps price subplot dates only on the bottom New York axis', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=DRAM&ticker=MU&ticker=STX&period=1y');
    await page.waitForFunction(() => (
        [...document.querySelectorAll('[data-price-subplot-canvas]')]
            .every((canvas) => Boolean(window.Chart?.getChart?.(canvas)))
    ));

    const axisVisibility = await page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => window.Chart.getChart(canvas).options.scales.x.display)
    ));
    expect(axisVisibility).toEqual([false, false, true]);
});

test('reorders price subplots and ticker fields without recreating charts', async ({page}) => {
    const liveRequests = [];
    page.on('request', (request) => {
        if (request.url().includes('/api/compare/live')) liveRequests.push(request.url());
    });
    await page.goto('/workspaces/prices?ticker=DRAM&ticker=MU&ticker=STX&period=3d');
    await page.waitForFunction(() => (
        [...document.querySelectorAll('[data-price-subplot-canvas]')]
            .every((canvas) => Boolean(window.Chart?.getChart?.(canvas)))
    ));
    await page.evaluate(() => {
        document.querySelectorAll('[data-price-subplot]').forEach((section) => {
            const canvas = section.querySelector('[data-price-subplot-canvas]');
            window.Chart.getChart(canvas).$orderIdentity = section.dataset.ticker;
        });
    });

    const firstSection = page.locator('[data-price-subplot][data-ticker="DRAM"]');
    const firstHandle = firstSection.locator('[data-price-subplot-order-handle]');
    const secondSection = page.locator('[data-price-subplot][data-ticker="MU"]');
    const firstBox = await firstSection.boundingBox();
    const secondBox = await secondSection.boundingBox();
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();

    await page.mouse.move(firstBox.x + (firstBox.width * 0.25), firstBox.y + (firstBox.height / 2));
    await expect.poll(() => firstHandle.evaluate((handle) => getComputedStyle(handle, '::after').opacity)).toBe('0');
    const hiddenHandleShadow = await firstHandle.evaluate((handle) => getComputedStyle(handle, '::after').boxShadow);
    await page.mouse.move(firstBox.x + (firstBox.width * 0.75), firstBox.y + (firstBox.height / 2));
    await expect.poll(() => firstHandle.evaluate((handle) => getComputedStyle(handle, '::after').opacity)).toBe('1');

    const handleMaterial = await firstHandle.evaluate((handle) => {
        const handleRect = handle.getBoundingClientRect();
        const sectionRect = handle.closest('[data-price-subplot]').getBoundingClientRect();
        const canvas = handle.closest('[data-price-subplot]').querySelector('[data-price-subplot-canvas]');
        const canvasRect = canvas.getBoundingClientRect();
        const chart = window.Chart.getChart(canvas);
        const glass = getComputedStyle(handle, '::after');
        return {
            lineDisplay: getComputedStyle(handle, '::before').display,
            handleVisualLeft: handleRect.left + (handleRect.width / 2) - 6,
            logoRight: canvasRect.left + chart.chartArea.right + 30,
            touchWidth: Math.round(handleRect.width),
            backdropFilter: glass.backdropFilter || glass.webkitBackdropFilter,
            boxShadow: glass.boxShadow,
            transform: glass.transform,
        };
    });
    expect(handleMaterial.lineDisplay).toBe('none');
    expect(handleMaterial.handleVisualLeft).toBeGreaterThan(handleMaterial.logoRight);
    expect(handleMaterial.touchWidth).toBeGreaterThanOrEqual(48);
    expect(handleMaterial.backdropFilter).toContain('blur');
    expect(handleMaterial.boxShadow).not.toBe(hiddenHandleShadow);
    expect(handleMaterial.transform).not.toBe('none');

    const handleBox = await firstHandle.boundingBox();
    expect(handleBox).not.toBeNull();
    await page.mouse.move(handleBox.x + (handleBox.width / 2), handleBox.y + (handleBox.height / 2));
    await page.mouse.down();
    await page.mouse.move(
        handleBox.x + (handleBox.width / 2),
        secondBox.y + (secondBox.height * 0.75),
        {steps: 6},
    );
    await expect(firstSection).toHaveClass(/is-order-dragging/);
    await expect(page.locator('.is-order-insert-before, .is-order-insert-after')).toHaveCount(1);
    expect(await firstSection.evaluate((section) => getComputedStyle(section).transform)).not.toBe('none');
    await page.mouse.up();
    await expect.poll(() => page.locator('#ticker_fields [data-order-motion="y-z"]').count()).toBeGreaterThan(0);

    const orderState = await page.evaluate(() => ({
        subplots: [...document.querySelectorAll('[data-price-subplot]')].map((section) => section.dataset.ticker),
        fields: [...document.querySelectorAll('#ticker_fields [data-ticker-input]')].map((input) => input.value),
        series: window.ANTIGRAVITY_APP.chart.series.map((item) => item.ticker),
        url: new URL(window.location.href).searchParams.getAll('ticker'),
        chartIdentity: [...document.querySelectorAll('[data-price-subplot]')].map((section) => {
            const canvas = section.querySelector('[data-price-subplot-canvas]');
            return window.Chart.getChart(canvas)?.$orderIdentity;
        }),
        axisVisibility: [...document.querySelectorAll('[data-price-subplot-canvas]')]
            .map((canvas) => window.Chart.getChart(canvas).options.scales.x.display),
    }));
    expect(orderState).toEqual({
        subplots: ['MU', 'DRAM', 'STX'],
        fields: ['MU', 'DRAM', 'STX'],
        series: ['MU', 'DRAM', 'STX'],
        url: ['MU', 'DRAM', 'STX'],
        chartIdentity: ['MU', 'DRAM', 'STX'],
        axisVisibility: [false, false, true],
    });
    expect(liveRequests).toHaveLength(0);
});

test('uses the compact Apple-style Live trading PIN dialog geometry', async ({page}) => {
    await page.goto('/trade/live-trading');

    const dialog = page.getByRole('dialog', {name: 'Unlock Live trading'});
    const close = dialog.getByRole('link', {name: 'Back to investment'});
    const unlock = dialog.getByRole('button', {name: 'Unlock'});
    await expect(dialog).toBeVisible();
    await expect(close).toBeVisible();
    await expect(dialog.getByRole('link', {name: 'Back', exact: true})).toHaveCount(0);

    const geometry = await dialog.evaluate((element) => {
        const icon = element.querySelector('.live-trading-pin-icon').getBoundingClientRect();
        const title = element.querySelector('.live-trading-pin-title').getBoundingClientRect();
        const button = element.querySelector('.live-trading-pin-button');
        const buttonRect = button.getBoundingClientRect();
        const buttonStyles = getComputedStyle(button);
        const dialogRect = element.getBoundingClientRect();
        return {
            buttonPaddingInline: Number.parseFloat(buttonStyles.paddingInlineStart),
            buttonWidth: buttonRect.width,
            dialogRadius: Number.parseFloat(getComputedStyle(element).borderRadius),
            dialogWidth: dialogRect.width,
            iconCenterY: icon.top + (icon.height / 2),
            titleCenterY: title.top + (title.height / 2),
        };
    });
    expect(Math.abs(geometry.iconCenterY - geometry.titleCenterY)).toBeLessThanOrEqual(0.5);
    expect(geometry.dialogRadius).toBe(24);
    expect(geometry.dialogWidth).toBeLessThanOrEqual(392);
    expect(geometry.buttonPaddingInline).toBe(14);
    expect(geometry.buttonWidth).toBeLessThan(82);

    const readSlotMarks = () => dialog.locator('.live-trading-pin-slot').evaluateAll((slots) => slots.map((slot) => {
        const slotRect = slot.getBoundingClientRect();
        const mark = getComputedStyle(slot, '::before');
        return {
            centerX: slotRect.left + (slotRect.width / 2),
            centerY: slotRect.top + (slotRect.height / 2),
            height: Number.parseFloat(mark.height),
            width: Number.parseFloat(mark.width),
        };
    }));
    const emptyMarks = await readSlotMarks();
    expect(emptyMarks).toHaveLength(6);
    expect(emptyMarks.every((mark) => mark.width === 20 && mark.height === 1)).toBe(true);
    expect(new Set(emptyMarks.map((mark) => mark.centerY)).size).toBe(1);
    const slotIntervals = emptyMarks.slice(1).map((mark, index) => mark.centerX - emptyMarks[index].centerX);
    expect(slotIntervals[0]).toBe(slotIntervals[1]);
    expect(slotIntervals[2]).toBe(slotIntervals[1] + 12);
    expect(slotIntervals[3]).toBe(slotIntervals[1]);
    expect(slotIntervals[4]).toBe(slotIntervals[1]);

    await dialog.locator('#live_trading_pin').fill('123');
    await expect(unlock).toBeDisabled();
    await expect.poll(readSlotMarks).toEqual([
        expect.objectContaining({width: 8, height: 8}),
        expect.objectContaining({width: 8, height: 8}),
        expect.objectContaining({width: 8, height: 8}),
        expect.objectContaining({width: 20, height: 1}),
        expect.objectContaining({width: 20, height: 1}),
        expect.objectContaining({width: 20, height: 1}),
    ]);

    await dialog.locator('#live_trading_pin').fill('1234');
    await expect.poll(readSlotMarks).toEqual([
        expect.objectContaining({width: 8, height: 8}),
        expect.objectContaining({width: 8, height: 8}),
        expect.objectContaining({width: 8, height: 8}),
        expect.objectContaining({width: 8, height: 8}),
        expect.objectContaining({width: 20, height: 1}),
        expect.objectContaining({width: 20, height: 1}),
    ]);

    await dialog.locator('#live_trading_pin').fill('123456');
    await expect(unlock).toBeEnabled();
});

test('applies the stored light and dark appearance to the Live trading PIN gate', async ({page}) => {
    await page.goto('/trade/live-trading');
    await page.evaluate(() => {
        window.localStorage.setItem('antigravity:theme-mode', 'dark');
    });
    await page.reload();

    const html = page.locator('html');
    const dialog = page.getByRole('dialog', {name: 'Unlock Live trading'});
    await expect(html).toHaveAttribute('data-theme-override', 'dark');
    const darkTheme = await dialog.evaluate((element) => {
        const rootStyles = getComputedStyle(document.documentElement);
        const bodyStyles = getComputedStyle(document.body);
        const titleStyles = getComputedStyle(element.querySelector('.live-trading-pin-title'));
        return {
            bodyBackground: bodyStyles.backgroundColor,
            bodyColor: bodyStyles.color,
            colorScheme: rootStyles.colorScheme,
            themeBackground: rootStyles.getPropertyValue('--theme-background').trim(),
            titleColor: titleStyles.color,
        };
    });
    expect(darkTheme.colorScheme).toBe('dark');
    expect(darkTheme.bodyColor).toBe(darkTheme.titleColor);
    expect(darkTheme.bodyBackground).not.toBe('rgb(255, 255, 255)');

    await page.evaluate(() => {
        window.localStorage.setItem('antigravity:theme-mode', 'light');
    });
    await page.reload();
    await expect(html).toHaveAttribute('data-theme-override', 'light');
    const lightTheme = await dialog.evaluate((element) => {
        const rootStyles = getComputedStyle(document.documentElement);
        const bodyStyles = getComputedStyle(document.body);
        return {
            bodyBackground: bodyStyles.backgroundColor,
            colorScheme: rootStyles.colorScheme,
            titleColor: getComputedStyle(element.querySelector('.live-trading-pin-title')).color,
        };
    });
    expect(lightTheme.colorScheme).toBe('light');
    expect(lightTheme.bodyBackground).not.toBe(darkTheme.bodyBackground);
    expect(lightTheme.titleColor).not.toBe(darkTheme.titleColor);
});

test('keeps ticker identity visible and range pills interactive on price performance', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=DRAM&ticker=MU&ticker=STX&period=1y');

    const identityStates = await page.locator('.ticker-input-control').evaluateAll((controls) => controls.map((control) => {
        const logo = control.querySelector('.ticker-input-logo');
        const placeholder = control.querySelector('.ticker-logo-placeholder');
        return {
            logoVisible: logo instanceof HTMLImageElement && !logo.hidden && logo.naturalWidth > 0,
            fallbackVisible: placeholder instanceof HTMLElement && !placeholder.hidden && Boolean(placeholder.textContent.trim()),
        };
    }));
    expect(identityStates.every((state) => state.logoVisible || state.fallbackVisible)).toBe(true);

    await page.locator('.range-mode-shell label[for="range_exact"]').click();
    await expect(page.locator('#range_exact')).toBeChecked();
    await expect(page.locator('#exact_panel')).toBeVisible();
    await page.locator('.range-mode-shell label[for="range_period"]').click();
    await expect(page.locator('#range_period')).toBeChecked();
    await expect(page.locator('#period_panel')).toBeVisible();
});

test('switches the Ticker comparison metric at the requested sidebar position', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=AAPL&ticker=NVDA&period=1y');

    const metricField = page.locator('xpath=/html/body/main/div/section/section/div/aside/form/div[3]');
    await expect(metricField).toHaveAttribute('data-comparison-metric-field', '');
    const placement = await metricField.evaluate((field) => ({
        previousId: field.previousElementSibling?.id || '',
        nextClasses: field.nextElementSibling?.className || '',
    }));
    expect(placement).toEqual({
        previousId: 'ticker_add_wrapper',
        nextClasses: expect.stringContaining('range-mode-field'),
    });

    const metricSwitch = metricField.locator('[data-comparison-metric-switch]');
    const priceMetric = metricSwitch.locator('[data-comparison-metric-input][value="price"]');
    const marketCapMetric = metricSwitch.locator('[data-comparison-metric-input][value="market-cap"]');
    await expect(priceMetric).toBeChecked();
    await expect(marketCapMetric).not.toBeChecked();
    const pricePillColor = await metricSwitch.evaluate((element) => getComputedStyle(element, '::before').backgroundColor);
    expect(pricePillColor).toBe('rgb(0, 85, 204)');
    expect(await page.evaluate(() => window.ANTIGRAVITY_APP.constraints.maxTickers)).toBe(5);

    const isMarketCapNavigation = (request) => {
        const url = new URL(request.url());
        return url.pathname === '/workspaces/prices' && url.searchParams.get('metric') === 'market-cap';
    };
    const marketCapNavigation = page.waitForRequest(isMarketCapNavigation);
    await page.route('**/workspaces/prices?*', async (route) => {
        if (isMarketCapNavigation(route.request())) {
            await route.abort();
            return;
        }
        await route.continue();
    });
    await metricSwitch.locator('label[for="comparison_metric_market_cap"]').click();
    const marketCapUrl = new URL((await marketCapNavigation).url());
    expect(marketCapUrl.searchParams.get('metric')).toBe('market-cap');
    expect(marketCapUrl.searchParams.getAll('ticker')).toEqual(['AAPL', 'NVDA']);
    expect(marketCapUrl.searchParams.has('period')).toBe(false);
});

test('keeps the Price chart responsive when 1 year is submitted twice', async ({page}) => {
    const consoleErrors = [];
    page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await page.goto('/workspaces/prices?ticker=AAPL&ticker=MSFT&range=6mo');
    const periodTrigger = page.locator('#period_panel [data-shared-select-trigger]');
    await expect(periodTrigger).toHaveAttribute('aria-label', 'Period: 6 months');
    await periodTrigger.click();
    await page.locator('#period_dropdown [role="option"][data-value="1y"]').click();

    // A repeated change event used to let an older hydration clean up the newer one.
    await page.evaluate(() => {
        document.querySelector('#period')?.dispatchEvent(new Event('change', {bubbles: true}));
    });

    await expect(page).toHaveURL(/\/workspaces\/prices\?ticker=AAPL&ticker=MSFT$/);
    await expect.poll(() => page.locator('#workspace_panel').getAttribute('data-workspace-pending'))
        .toBeNull();
    await expect(page.locator('#period')).toHaveValue('1y');
    await expect(page.locator('.price-compare-range'))
        .toHaveText(/^\d{2} [A-Z][a-z]{2} \d{4} - \d{2} [A-Z][a-z]{2} \d{4}$/);
    await expect(page.locator('canvas')).toHaveCount(2);
    expect(consoleErrors.filter((message) => message.includes('Hydration Error'))).toEqual([]);
});

test('keeps the Ticker comparison metric control within the narrow sidebar viewport', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/workspaces/prices?ticker=AAPL&ticker=NVDA&period=1y');

    const sidebarToggle = page.locator('#sidebar_toggle');
    if (await sidebarToggle.getAttribute('aria-expanded') !== 'true') {
        await sidebarToggle.click();
    }

    const metricField = page.locator('xpath=/html/body/main/div/section/section/div/aside/form/div[3]');
    await expect(metricField).toBeVisible();
    const geometry = await metricField.evaluate((field) => {
        const rect = field.getBoundingClientRect();
        const control = field.querySelector('[data-comparison-metric-switch]');
        const controlRect = control?.getBoundingClientRect();
        return {
            field: {left: rect.left, right: rect.right},
            control: controlRect ? {left: controlRect.left, right: controlRect.right} : null,
            viewportWidth: window.innerWidth,
        };
    });
    expect(geometry.field.left).toBeGreaterThanOrEqual(0);
    expect(geometry.field.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.control).not.toBeNull();
    expect(geometry.control?.left).toBeGreaterThanOrEqual(0);
    expect(geometry.control?.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
});

test('keeps the range pill aligned after responsive sidebar resizing', async ({page}) => {
    const exactUrl = '/workspaces/prices?ticker=AAPL&ticker=MSFT&range=exact&period=1d&date=2026-07-15';
    await page.setViewportSize({width: 390, height: 844});
    await page.goto(exactUrl);
    await setSidebarExpanded(page, false);
    await page.setViewportSize({width: 1008, height: 1123});
    await page.waitForTimeout(500);

    const pillState = await page.locator('.range-mode-shell').evaluate((element) => {
        const pseudo = getComputedStyle(element, '::before');
        const shellRect = element.getBoundingClientRect();
        const activeOption = element.querySelector('input:checked')?.closest('.segmented-control-option');
        const activeRect = activeOption?.getBoundingClientRect();
        const transformMatch = pseudo.transform.match(
            /^matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*([-\d.]+)/,
        );
        const translateX = pseudo.transform === 'none'
            ? 0
            : Number.parseFloat(transformMatch?.[1] || 'NaN');
        const pillLeft = shellRect.left + (Number.parseFloat(pseudo.left) || 0) + translateX;
        const pillRight = pillLeft + (Number.parseFloat(pseudo.width) || 0);
        return {
            leftDelta: activeRect ? Math.abs(pillLeft - activeRect.left) : Number.POSITIVE_INFINITY,
            rightDelta: activeRect ? Math.abs(pillRight - activeRect.right) : Number.POSITIVE_INFINITY,
            shellRight: shellRect.right,
            pillRight,
        };
    });

    expect(pillState.leftDelta).toBeLessThanOrEqual(1);
    expect(pillState.rightDelta).toBeLessThanOrEqual(1);
    expect(pillState.pillRight).toBeLessThanOrEqual(pillState.shellRight + 1);
});

test('keeps the active one-day trading date when switching Price performance to Exact', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=QQQ&ticker=AAPL&period=1d');
    await page.locator('form.controls').evaluate((form) => {
        form.addEventListener('submit', (event) => event.preventDefault(), {capture: true});
    });
    await page.evaluate(() => {
        const currentTradingDate = '2026-07-23';
        const staleReferenceDate = '2026-07-13';
        window.ANTIGRAVITY_APP.chart.tradingDate = staleReferenceDate;
        for (const id of ['exact_trading_date', 'exact_start', 'exact_end']) {
            document.getElementById(id).value = staleReferenceDate;
        }
        const summary = document.querySelector('.price-compare-range');
        if (summary) summary.textContent = '23 Jul 2026 CST';
    });

    await page.locator('.range-mode-shell label[for="range_exact"]').click();

    await expect(page.locator('#exact_trading_date')).toHaveValue('2026-07-23');
    await expect(page.locator('#exact_start')).toHaveValue('2026-07-23');
    await expect(page.locator('#exact_end')).toHaveValue('2026-07-23');
});

test('presents an active cross-market one-day refresh on the live trading date', async ({page}) => {
    await page.route('**/api/compare/live?*', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                liveDate: '2026-07-14',
                liveSessionActive: true,
                displayRange: '14 Jul 2026',
                series: ['000660.KS', '7709.HK'].map((ticker, index) => ({
                    ticker,
                    raw_dates: ['2026-07-13 20:00', '2026-07-13 20:01'],
                    dates: ['14 Jul 2026 09:00', '14 Jul 2026 09:01'],
                    prices: [100 + index, 101 + index],
                    candlestick_prices: [
                        {x: 0, o: 100 + index, h: 101 + index, l: 99 + index, c: 100.5 + index},
                        {x: 1, o: 100.5 + index, h: 102 + index, l: 100 + index, c: 101 + index},
                    ],
                })),
            }),
        });
    });
    await page.goto('/workspaces/prices?ticker=000660.KS&ticker=7709.HK&period=1d');

    const headingDates = await page.evaluate(() => ({
        base: window.ANTIGRAVITY_BOOTSTRAP.dateDisplay.formatFullDateParts({year: 2026, monthIndex: 6, day: 14}),
        local: window.ANTIGRAVITY_BOOTSTRAP.formatPriceCompareHeadingDate('2026-07-14'),
        hongKong: window.ANTIGRAVITY_BOOTSTRAP.formatPriceCompareHeadingDate('2026-07-14', 'Asia/Hong_Kong'),
        seoul: window.ANTIGRAVITY_BOOTSTRAP.formatPriceCompareHeadingDate('2026-07-14', 'Asia/Seoul'),
    }));
    await expect(page.locator('.price-compare-range')).toHaveText(headingDates.local);
    expect(headingDates.hongKong).toBe(`${headingDates.base} HKT`);
    expect(headingDates.seoul).toBe(`${headingDates.base} KST`);
    await expect.poll(() => page.evaluate(() => window.ANTIGRAVITY_APP.chart.tradingDate)).toBe('2026-07-14');
    const rawDates = await page.evaluate(() => window.ANTIGRAVITY_APP.chart.series[0].raw_dates);
    expect(rawDates).toHaveLength(480);
    expect(rawDates[0]).toBe('2026-07-13 20:00');
    expect(rawDates.at(-1)).toBe('2026-07-14 03:59');

    const exactHeading = await page.evaluate(() => {
        window.history.replaceState({}, '', '/workspaces/prices?ticker=000660.KS&ticker=7709.HK&range=exact&period=1d&trading_date=2026-07-14');
        window.ANTIGRAVITY_APP.chart.tradingDate = '2026-07-13';
        window.ANTIGRAVITY_BOOTSTRAP.initPriceCompareWorkspace();
        return window.ANTIGRAVITY_BOOTSTRAP.formatPriceCompareHeadingDate('2026-07-14');
    });
    await expect(page.locator('.price-compare-range')).toHaveText(exactHeading);
});

test('shows immediate price-range feedback and preserves add-ticker after hydration', async ({page}) => {
    await page.route('**/workspaces/prices?*', async (route) => {
        const request = route.request();
        const isHydration = request.headers()['x-requested-with'] === 'workspace-hydrate';
        const requestParams = new URL(request.url()).searchParams;
        const isSixMonths = (requestParams.get('range') || requestParams.get('period')) === '6mo';
        if (isHydration && isSixMonths) {
            await new Promise((resolve) => setTimeout(resolve, 600));
        }
        await route.continue();
    });
    await page.goto('/workspaces/prices?ticker=DRAM&ticker=MU&ticker=STX&period=1y');

    await page.locator('#period').evaluate((select) => {
        select.value = '6mo';
        select.dispatchEvent(new Event('change', {bubbles: true}));
    });

    await expect(page.locator('#workspace_modal_overlay')).toBeVisible();
    await expect(page.locator('#workspace_modal_overlay .workspace-modal-title')).toHaveText('Updating price history');
    await expect(page.locator('.workspace-mode-main .report-heading')).toHaveText('Price history');
    await expect(page.locator('.workspace-mode-main .price-compare-range')).not.toBeEmpty();
    await expect(page).toHaveURL(/range=6mo/);
    await expect(page.locator('#workspace_modal_overlay')).toBeHidden();

    await page.locator('#add_ticker').click();
    await expect(page.locator('#ticker_4')).toBeVisible();
});

test('shows immediate feedback while a five-year market-cap range is calculated', async ({page}) => {
    await page.setViewportSize({width: 1_024, height: 768});
    await page.goto('/workspaces/prices?metric=market-cap&ticker=AAPL&ticker=NVDA&period=1d');
    await expect(page.getByRole('heading', {name: 'Market cap comparison', exact: true, level: 2})).toBeVisible();
    await expect(page.getByRole('heading', {name: 'Market cap history', exact: true, level: 2})).toBeVisible();
    await expect(page.locator('.market-cap-compare-workspace')).toHaveAttribute('aria-labelledby', 'ticker_comparison_heading');
    await expect(page.locator('.workspace-mode-controls-surface')).toHaveAttribute('aria-labelledby', 'ticker_comparison_heading');
    await expect(page.locator('.workspace-mode-main')).toHaveAttribute('aria-labelledby', 'market_cap_history_heading');
    const marketCapResultArticle = page.locator('xpath=/html/body/main/div/section/section/div/section/div/article');
    await expect(marketCapResultArticle).toHaveCount(1);
    await expect(marketCapResultArticle.locator('.market-cap-compare-range')).toHaveCount(1);
    await expect(page.locator('xpath=/html/body/main/div/section/section/div/section/div/header/div/span')).toHaveCount(0);

    const range = page.locator('.market-cap-compare-range');
    await expect(range).toBeVisible();
    await expect(range).not.toHaveText('');
    const headingGeometry = await page.evaluate(() => {
        const modeCard = document.querySelector('.workspace-mode-title-card').getBoundingClientRect();
        const controls = document.querySelector('.workspace-mode-controls-surface').getBoundingClientRect();
        const resultCard = document.querySelector('.workspace-mode-main .workspace-summary-card').getBoundingClientRect();
        const main = document.querySelector('.workspace-mode-main').getBoundingClientRect();
        const heading = document.querySelector('#market_cap_history_heading').getBoundingClientRect();
        const displayRange = document.querySelector('.market-cap-compare-range').getBoundingClientRect();
        return {
            modeColumnDelta: Math.abs(modeCard.right - controls.right),
            resultColumnDelta: Math.abs(resultCard.left - main.left),
            titleColumnGap: resultCard.left - modeCard.right,
            rangeLeftDelta: Math.abs(displayRange.left - heading.left),
            rangeVerticalGap: displayRange.top - heading.bottom,
        };
    });
    expect(headingGeometry.modeColumnDelta).toBeLessThanOrEqual(1);
    expect(headingGeometry.resultColumnDelta).toBeLessThanOrEqual(1);
    expect(headingGeometry.titleColumnGap).toBeGreaterThanOrEqual(11);
    expect(headingGeometry.rangeLeftDelta).toBeLessThanOrEqual(1);
    expect(headingGeometry.rangeVerticalGap).toBeGreaterThanOrEqual(1);

    const hydrationHtml = await page.content();
    await page.route('**/api/market-store/presence?*', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({missingHistory: []}),
        });
    });
    await page.route('**/workspaces/prices?*', async (route) => {
        const request = route.request();
        const isHydration = request.headers()['x-requested-with'] === 'workspace-hydrate';
        const requestParams = new URL(request.url()).searchParams;
        const isMarketCap = requestParams.get('metric') === 'market-cap';
        const isFiveYears = (requestParams.get('range') || requestParams.get('period')) === '5y';
        if (isHydration && isMarketCap && isFiveYears) {
            await new Promise((resolve) => setTimeout(resolve, 600));
            await route.fulfill({
                contentType: 'text/html',
                body: hydrationHtml,
            });
            return;
        }
        await route.continue();
    });

    await page.locator('#period').evaluate((select) => {
        select.value = '5y';
        select.dispatchEvent(new Event('change', {bubbles: true}));
    });

    const overlay = page.locator('#workspace_modal_overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('.workspace-modal-title')).toHaveText('Calculating market-cap history');
    await expect(overlay.locator('.workspace-modal-copy')).toContainText('Longer ranges may take a moment.');
    await expect(page).toHaveURL(/range=5y/);
    await expect(overlay).toBeHidden();
});

test('submits a valid market-cap ticker after it is committed by blur', async ({page}) => {
    await page.route('**/api/market-store/presence?*', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({missingHistory: []}),
        });
    });
    await page.goto('/workspaces/prices?metric=market-cap&ticker=AAPL&ticker=NVDA&ticker=GOOGL&period=1y');
    await page.locator('#add_ticker').click();
    const tickerInput = page.locator('#ticker_4');
    await tickerInput.fill('MSFT');
    const hydrationHtml = await page.content();
    await page.route('**/workspaces/prices?*', async (route) => {
        const request = route.request();
        const isMarketCap = new URL(request.url()).searchParams.get('metric') === 'market-cap';
        if (isMarketCap && request.headers()['x-requested-with'] === 'workspace-hydrate') {
            await route.fulfill({contentType: 'text/html', body: hydrationHtml});
            return;
        }
        await route.continue();
    });

    await page.locator('.workspace-mode-main').click({position: {x: 420, y: 560}});

    await expect(page.locator('#workspace_modal_overlay .workspace-modal-title')).toHaveText(
        /^(Calculating comparison|Updating local market data)$/,
    );
    await expect(page).toHaveURL(/ticker=MSFT/);
    await expect(page.locator('#workspace_modal_overlay')).toBeHidden();
    await expect(page.locator('#market_cap_history_heading')).toBeVisible();
});

test('switches short price ranges and formats price axes by currency precision', async ({page}) => {
    await page.route('**/api/compare/live?*', async (route) => {
        await fulfillInertPriceLiveResponse(route, ['DRAM', 'MU', 'STX']);
    });
    await page.goto('/workspaces/prices?ticker=DRAM&ticker=MU&ticker=STX&period=3d');
    await page.waitForFunction(() => Boolean(window.Chart?.getChart?.(document.querySelector('[data-price-subplot-canvas]'))));

    const formattedTicks = await page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => window.Chart.getChart(canvas).options.scales.y.ticks.callback(1040))
    ));
    expect(formattedTicks).toEqual(['1,040', '1,040', '1,040']);

    const fractionalTick = await page.locator('[data-price-subplot-canvas]').first().evaluate((canvas) => (
        window.Chart.getChart(canvas).options.scales.y.ticks.callback(1040.5)
    ));
    expect(fractionalTick).toBe('1,040.5');

    const threeDayAxis = await page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => {
            const labels = window.Chart.getChart(canvas).data.labels;
            const dayCounts = labels.reduce((counts, label) => {
                const day = String(label).slice(0, 10);
                counts[day] = (counts[day] || 0) + 1;
                return counts;
            }, {});
            return {
                dayCounts: Object.values(dayCounts),
                dayCount: canvas.dataset.tradingDayCount,
                separators: canvas.dataset.tradingDaySeparators,
            };
        })
    ));
    expect(threeDayAxis.every((item) => (
        item.dayCounts.length === 3
        && item.dayCounts.every((count) => count === 390)
        && item.dayCount === '3'
        && item.separators === '2'
    ))).toBe(true);

    await page.locator('#period').evaluate((select) => {
        select.value = '1d';
        select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await expect(page.locator('#workspace_modal_overlay')).toBeVisible();
    await expect(page).toHaveURL(/range=1d/, {timeout: 30_000});
    await expect(page.locator('#workspace_modal_overlay')).toBeHidden();
    await expect(page.locator('[data-shared-select-trigger-label]')).toHaveText('1 day');

    const oneDayRenderModes = await page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => ({
            mode: canvas.dataset.chartRenderMode,
            candlePolicy: canvas.dataset.candlePolicy,
            candleBodyStyle: canvas.dataset.candleBodyStyle,
            candleWidthBasis: canvas.dataset.candleWidthBasis,
            candleAlpha: canvas.dataset.candleAlpha,
            candleWidth: canvas.dataset.candleWidth,
            seriesColor: canvas.dataset.seriesColor,
            borderColor: window.Chart.getChart(canvas).data.datasets[0].borderColor,
            showLine: window.Chart.getChart(canvas).data.datasets[0].showLine,
        }))
    ));
    expect(oneDayRenderModes.every((item) => (
        item.mode === 'candlestick'
        && item.candlePolicy === 'v1'
        && item.candleBodyStyle === 'solid'
        && item.candleWidthBasis === 'shared-timeline'
        && item.candleAlpha === '0.82'
        && item.showLine === false
        && item.seriesColor === item.borderColor
    ))).toBe(true);
    expect(new Set(oneDayRenderModes.map((item) => item.candleWidth)).size).toBe(1);
    expect(new Set(oneDayRenderModes.map((item) => item.seriesColor)).size).toBe(3);

    const oneDayAxisLabels = await page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => {
            const chart = window.Chart.getChart(canvas);
            const labels = chart.data.labels;
            const callback = chart.options.scales.x.ticks.callback;
            const indexes = [0, Math.floor((labels.length - 1) / 2), labels.length - 1];
            return {
                count: canvas.dataset.singleDayTimeLabels,
                labels: indexes.map((index) => callback(index, index)),
            };
        })
    ));
    expect(oneDayAxisLabels.every((item) => (
        item.count === '3'
        && item.labels.every((label) => Array.isArray(label) && label.length === 2 && /^\d{2}:\d{2}$/.test(label[0]))
    ))).toBe(true);

    const oneDaySessionDividers = await page.evaluate(() => {
        const originalSeries = window.ANTIGRAVITY_APP.chart.series;
        const minutes = Array.from({length: 960}, (_, index) => {
            const totalMinutes = (4 * 60) + index;
            return `2026-07-10 ${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
        });
        window.ANTIGRAVITY_APP.chart.series = originalSeries.map((item, seriesIndex) => ({
            ...item,
            raw_dates: minutes,
            dates: minutes,
            prices: minutes.map((_value, index) => 100 + (seriesIndex * 10) + (index * 0.01)),
            candlestick_prices: minutes.map((_value, index) => {
                const price = 100 + (seriesIndex * 10) + (index * 0.01);
                return {x: index, o: price, h: price + 0.2, l: price - 0.2, c: price + 0.1, v: 100};
            }),
        }));
        window.ANTIGRAVITY_BOOTSTRAP.initPriceCompareWorkspace();
        const canvases = [...document.querySelectorAll('[data-price-subplot-canvas]')];
        const result = canvases.map((canvas, index) => {
            const chart = window.Chart.getChart(canvas);
            const indexes = canvas.dataset.oneDaySessionDividerIndexes.split(',').map((pair) => pair.split(':').map(Number));
            return {
                count: canvas.dataset.oneDaySessionDividers,
                indexes: canvas.dataset.oneDaySessionDividerIndexes,
                lineStyle: canvas.dataset.oneDaySessionDividerLineStyle,
                pluginId: chart.config.plugins.find((plugin) => plugin.id === `priceOneDaySessionDivider${index}`)?.id || '',
                positions: indexes.map(([leftIndex, rightIndex]) => (
                    (chart.scales.x.getPixelForValue(leftIndex) + chart.scales.x.getPixelForValue(rightIndex)) / 2
                )),
                chartArea: {top: chart.chartArea.top, bottom: chart.chartArea.bottom},
            };
        });
        window.ANTIGRAVITY_APP.chart.series = originalSeries;
        window.ANTIGRAVITY_BOOTSTRAP.initPriceCompareWorkspace();
        return result;
    });
    expect(oneDaySessionDividers.every((item) => (
        item.count === '2'
        && item.lineStyle === 'solid-session-divider'
        && item.indexes.split(',').length === 2
        && item.pluginId
        && item.positions.length === 2
        && item.positions[0] < item.positions[1]
        && item.chartArea.bottom > item.chartArea.top
    ))).toBe(true);
    expect(new Set(oneDaySessionDividers.map((item) => item.indexes)).size).toBe(1);
    expect(new Set(oneDaySessionDividers.flatMap((item) => item.positions.map((position) => position.toFixed(3)))).size).toBe(2);
    const firstDividerPositions = oneDaySessionDividers[0].positions;
    expect(oneDaySessionDividers.slice(1).every((item) => item.positions.every((position, positionIndex) => (
        Math.abs(position - firstDividerPositions[positionIndex]) <= 0.01
    )))).toBe(true);

    const overnightSessionDividers = await page.evaluate(() => {
        const originalSeries = window.ANTIGRAVITY_APP.chart.series;
        const originalHref = window.location.href;
        const overnightInput = document.querySelector('#include_overnight_hours');
        const originalChecked = Boolean(overnightInput?.checked);
        const minutes = Array.from({length: 1440}, (_, index) => (
            new Date(Date.UTC(2026, 6, 14, 20, 0) + (index * 60000)).toISOString().slice(0, 16).replace('T', ' ')
        ));
        if (overnightInput) overnightInput.checked = true;
        const params = new URLSearchParams(window.location.search);
        params.set('overnight', '1');
        window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
        window.ANTIGRAVITY_APP.chart.series = originalSeries.map((item, seriesIndex) => ({
            ...item,
            raw_dates: minutes,
            dates: minutes,
            prices: minutes.map((_value, index) => 100 + (seriesIndex * 10) + (index * 0.01)),
            candlestick_prices: minutes.map((_value, index) => {
                const price = 100 + (seriesIndex * 10) + (index * 0.01);
                return {x: index, o: price, h: price + 0.2, l: price - 0.2, c: price + 0.1, v: 100};
            }),
        }));
        window.ANTIGRAVITY_BOOTSTRAP.initPriceCompareWorkspace();
        const canvases = [...document.querySelectorAll('[data-price-subplot-canvas]')];
        const result = canvases.map((canvas, index) => {
            const chart = window.Chart.getChart(canvas);
            const indexes = canvas.dataset.oneDaySessionDividerIndexes.split(',').map((pair) => pair.split(':').map(Number));
            return {
                count: canvas.dataset.oneDaySessionDividers,
                indexes: canvas.dataset.oneDaySessionDividerIndexes,
                lineStyle: canvas.dataset.oneDaySessionDividerLineStyle,
                pluginId: chart.config.plugins.find((plugin) => plugin.id === `priceOneDaySessionDivider${index}`)?.id || '',
                positions: indexes.map(([leftIndex, rightIndex]) => (
                    (chart.scales.x.getPixelForValue(leftIndex) + chart.scales.x.getPixelForValue(rightIndex)) / 2
                )),
                chartArea: {top: chart.chartArea.top, bottom: chart.chartArea.bottom},
            };
        });
        window.ANTIGRAVITY_APP.chart.series = originalSeries;
        if (overnightInput) overnightInput.checked = originalChecked;
        window.history.replaceState({}, '', originalHref);
        window.ANTIGRAVITY_BOOTSTRAP.initPriceCompareWorkspace();
        return result;
    });
    expect(overnightSessionDividers.every((item) => (
        item.count === '3'
        && item.lineStyle === 'solid-session-divider'
        && item.indexes.split(',').length === 3
        && item.pluginId
        && item.positions.length === 3
        && item.positions[0] < item.positions[1]
        && item.positions[1] < item.positions[2]
        && item.chartArea.bottom > item.chartArea.top
    ))).toBe(true);
    expect(new Set(overnightSessionDividers.map((item) => item.indexes)).size).toBe(1);
    const firstOvernightDividerPositions = overnightSessionDividers[0].positions;
    expect(overnightSessionDividers.slice(1).every((item) => item.positions.every((position, positionIndex) => (
        Math.abs(position - firstOvernightDividerPositions[positionIndex]) <= 0.01
    )))).toBe(true);

    const referenceLine = await page.evaluate(() => {
        const originalSeries = window.ANTIGRAVITY_APP.chart.series[2];
        const originalProfile = window.ANTIGRAVITY_APP.chart.profiles[2];
        const minutes = Array.from({length: 121}, (_, index) => {
            const totalMinutes = (9 * 60) + 30 + index;
            return `2026-07-10 ${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
        });
        const candles = minutes.map((_value, index) => ({x: index, o: null, h: null, l: null, c: null}));
        candles[14] = {x: 14, o: 149, h: 149, l: 149, c: 149};
        candles[120] = {x: 120, o: 170, h: 172, l: 169, c: 171};
        window.ANTIGRAVITY_APP.chart.series[2] = {
            ...window.ANTIGRAVITY_APP.chart.series[2],
            ticker: 'SKHYV',
            raw_dates: minutes,
            dates: minutes,
            prices: minutes.map((_value, index) => index === 14 ? 149 : (index === 120 ? 171 : null)),
            candlestick_prices: candles,
        };
        window.ANTIGRAVITY_APP.chart.profiles[2] = {
            ticker: 'SKHYV',
            logo_url: '/market-store/logos/000660.KS.svg',
        };
        window.ANTIGRAVITY_BOOTSTRAP.initPriceCompareWorkspace();
        const canvases = [...document.querySelectorAll('[data-price-subplot-canvas]')];
        const result = {
            price: canvases[2].dataset.referencePrice,
            startIndex: canvases[2].dataset.referencePriceStartIndex,
            startTime: canvases[2].dataset.referencePriceStartTime,
            endIndex: canvases[2].dataset.referencePriceEndIndex,
        };
        window.ANTIGRAVITY_APP.chart.series[2] = originalSeries;
        window.ANTIGRAVITY_APP.chart.profiles[2] = originalProfile;
        window.ANTIGRAVITY_BOOTSTRAP.initPriceCompareWorkspace();
        return result;
    });
    expect(referenceLine).toEqual({price: '149.00', startIndex: '0', startTime: '2026-07-10 09:30', endIndex: '120'});

    const currencyPrecision = await page.evaluate(() => ({
        krw: window.ANTIGRAVITY_BOOTSTRAP.currencyDisplay.format(2300000, 'KRW'),
        jpy: window.ANTIGRAVITY_BOOTSTRAP.currencyDisplay.format(1040, 'JPY'),
        usd: window.ANTIGRAVITY_BOOTSTRAP.currencyDisplay.format(64, 'USD'),
    }));
    expect(currencyPrecision).toEqual({krw: 'KRW 2,300,000', jpy: 'JPY 1,040', usd: 'USD 64.00'});

    const tooltipDateLines = await page.evaluate(() => {
        const host = document.createElement('div');
        host.innerHTML = window.ANTIGRAVITY_BOOTSTRAP.formatPriceSharedTooltipDate(
            '2026-07-10 12:53',
            [],
            {period: '3d'},
        );
        const shortRange = {
            date: host.querySelector('.chart-tooltip-primary-date')?.textContent || '',
            time: host.querySelector('.chart-tooltip-market-time')?.textContent || '',
        };
        host.innerHTML = window.ANTIGRAVITY_BOOTSTRAP.formatPriceSharedTooltipDate(
            '2026-07-10 12:53',
            [],
            {period: '6mo'},
        );
        const originalHref = window.location.href;
        const renderTooltipForPeriod = (period) => {
            const params = new URLSearchParams(window.location.search);
            params.set('range', period);
            params.delete('period');
            window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
            window.ANTIGRAVITY_BOOTSTRAP.initPriceCompareWorkspace();
            const canvas = document.querySelector('[data-price-subplot-canvas]');
            const chart = window.Chart.getChart(canvas);
            chart.options.onHover(
                {y: chart.chartArea.top},
                [{index: 0}],
                chart,
            );
            const tooltip = document.querySelector('.price-shared-tooltip');
            return {
                date: tooltip?.querySelector('.chart-tooltip-primary-date')?.textContent || '',
                time: tooltip?.querySelector('.chart-tooltip-market-time')?.textContent || '',
            };
        };
        const renderedShortRange = renderTooltipForPeriod('3d');
        const renderedLongRange = renderTooltipForPeriod('6mo');
        window.history.replaceState({}, '', originalHref);
        window.ANTIGRAVITY_BOOTSTRAP.initPriceCompareWorkspace();
        return {
            date: host.querySelector('.chart-tooltip-primary-date')?.textContent || '',
            expectedDate: window.ANTIGRAVITY_BOOTSTRAP.dateDisplay.formatFullDateParts({
                year: 2026,
                monthIndex: 6,
                day: 11,
            }),
            time: host.querySelector('.chart-tooltip-market-time')?.textContent || '',
            shortRange,
            renderedShortRange,
            renderedLongRange,
        };
    });
    expect(tooltipDateLines.date).toBe(tooltipDateLines.expectedDate);
    expect(tooltipDateLines.time).toBe('');
    expect(tooltipDateLines.shortRange).toEqual({
        date: tooltipDateLines.expectedDate,
        time: '00:53 HKT',
    });
    expect(tooltipDateLines.renderedShortRange.time).toBeTruthy();
    expect(tooltipDateLines.renderedLongRange.time).toBe('');

    const multiMarketPresentation = await page.evaluate(() => {
        const tickers = ['0005.HK', 'HSBA.L', 'HSBC'];
        const rawDates = [
            '2026-07-10 03:00',
            '2026-07-10 04:00',
            '2026-07-10 09:30',
        ];
        const host = document.createElement('div');
        host.innerHTML = window.ANTIGRAVITY_BOOTSTRAP.formatPriceSharedTooltipDate(
            '2026-07-09 23:06',
            tickers,
        );
        const originalSeries = window.ANTIGRAVITY_APP.chart.series;
        const originalProfiles = window.ANTIGRAVITY_APP.chart.profiles;
        window.ANTIGRAVITY_APP.chart.series = tickers.map((ticker, index) => ({
            ticker,
            raw_dates: rawDates,
            dates: rawDates,
            prices: [100 + index, 101 + index, 102 + index],
            color: ['#0055cc', '#7f42af', '#ff2f92'][index],
        }));
        window.ANTIGRAVITY_APP.chart.profiles = tickers.map((ticker) => ({
            ticker,
            logo_url: null,
        }));
        window.ANTIGRAVITY_BOOTSTRAP.initPriceCompareWorkspace();
        const lineStyles = [...document.querySelectorAll('[data-price-subplot-canvas]')]
            .map((canvas) => canvas.dataset.marketSessionLineStyle || '');
        const result = {
            events: window.ANTIGRAVITY_BOOTSTRAP.buildPriceMarketSessionEvents(rawDates, tickers),
            koreaUsEvents: window.ANTIGRAVITY_BOOTSTRAP.buildPriceMarketSessionEvents(
                ['2026-07-09 20:00', '2026-07-10 02:30', '2026-07-10 04:00'],
                ['000660.KS', 'SKHYV'],
            ),
            lineStyles,
            date: host.querySelector('.chart-tooltip-primary-date')?.textContent || '',
            expectedDate: window.ANTIGRAVITY_BOOTSTRAP.dateDisplay.formatFullDateParts({
                year: 2026,
                monthIndex: 6,
                day: 10,
            }),
            times: [...host.querySelectorAll('.chart-tooltip-market-time')].map((item) => item.textContent),
            collisionSafeLabels: window.ANTIGRAVITY_BOOTSTRAP.layoutPriceMarketSessionLabels({
                events: [
                    {index: 0, labelLines: ['20:00']},
                    {index: 1, labelLines: ['02:30']},
                    {index: 2, labelLines: ['04:00']},
                ],
                getX: (event) => [8, 48, 60][event.index],
                measureText: () => 34,
                left: 0,
                right: 150,
                gap: 10,
            }).map(({x, width}) => ({x, width})),
        };
        window.ANTIGRAVITY_APP.chart.series = originalSeries;
        window.ANTIGRAVITY_APP.chart.profiles = originalProfiles;
        window.ANTIGRAVITY_BOOTSTRAP.initPriceCompareWorkspace();
        return result;
    });
    expect(multiMarketPresentation.events.map((event) => ({
        index: event.index,
        labelLines: event.labelLines,
    }))).toEqual([
        {index: 0, labelLines: ['03:00']},
        {index: 1, labelLines: ['04:00']},
    ]);
    expect(multiMarketPresentation.lineStyles).toEqual([
        'solid-session-divider',
        'solid-session-divider',
        'solid-session-divider',
    ]);
    expect(multiMarketPresentation.koreaUsEvents.map((event) => ({
        index: event.index,
        labelLines: event.labelLines,
    }))).toEqual([
        {index: 0, labelLines: ['20:00']},
        {index: 1, labelLines: ['02:30']},
        {index: 2, labelLines: ['04:00']},
    ]);
    expect(multiMarketPresentation.date).toBe(multiMarketPresentation.expectedDate);
    expect(multiMarketPresentation.times).toEqual([
        '11:06 HKT',
        '04:06 BST',
        '23:06 EDT (-1)',
    ]);
    expect(multiMarketPresentation.collisionSafeLabels[0].x).toBeGreaterThanOrEqual(17);
    expect(multiMarketPresentation.collisionSafeLabels[2].x).toBeLessThanOrEqual(133);
    expect(multiMarketPresentation.collisionSafeLabels[1].x - multiMarketPresentation.collisionSafeLabels[0].x).toBeGreaterThanOrEqual(44);
    expect(multiMarketPresentation.collisionSafeLabels[2].x - multiMarketPresentation.collisionSafeLabels[1].x).toBeGreaterThanOrEqual(44);

    await page.evaluate(() => window.ANTIGRAVITY_BOOTSTRAP.refreshPriceCompareLive());
    const labelsAfterEmptyRefresh = await page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => window.Chart.getChart(canvas).data.datasets[0].label)
    ));
    expect(labelsAfterEmptyRefresh).toEqual(['DRAM', 'MU', 'STX']);

    await page.locator('#period').evaluate((select) => {
        select.value = '3d';
        select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await expect(page.locator('#workspace_modal_overlay')).toBeVisible();
    await expect(page).toHaveURL(/range=3d/, {timeout: 30_000});
    await expect(page.locator('#workspace_modal_overlay')).toBeHidden();
    await expect(page.locator('[data-shared-select-trigger-label]')).toHaveText('3 days');
});

test('discards an obsolete live-price response after the selected range changes', async ({page}) => {
    let releaseLiveResponse;
    const liveRequestStarted = new Promise((resolve) => {
        releaseLiveResponse = resolve;
    });
    let fulfillLiveResponse;
    let shouldHoldLiveResponse = false;
    await page.route('**/api/compare/live?*', async (route) => {
        if (!shouldHoldLiveResponse) {
            await fulfillInertPriceLiveResponse(route, ['DRAM', 'MU', 'STX']);
            return;
        }
        await new Promise((resolve) => {
            fulfillLiveResponse = resolve;
            releaseLiveResponse();
        });
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                series: [{
                    ticker: 'STALE',
                    raw_dates: ['2026-07-08 09:30'],
                    dates: ['8 Jul 2026 09:30'],
                    prices: [1.0],
                    candlestick_prices: [],
                }],
            }),
        });
    });
    await page.goto('/workspaces/prices?ticker=DRAM&ticker=MU&ticker=STX&period=3d');
    await page.waitForFunction(() => Boolean(window.Chart?.getChart?.(document.querySelector('[data-price-subplot-canvas]'))));

    shouldHoldLiveResponse = true;
    const refreshPromise = page.evaluate(() => window.ANTIGRAVITY_BOOTSTRAP.refreshPriceCompareLive());
    await liveRequestStarted;
    await page.evaluate(() => {
        const params = new URLSearchParams(window.location.search);
        params.set('period', '1d');
        window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
    });
    fulfillLiveResponse();
    await refreshPromise;

    const chartLabels = await page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => window.Chart.getChart(canvas).data.datasets[0].label)
    ));
    expect(chartLabels).toEqual(['DRAM', 'MU', 'STX']);
});

test('validates the investment import flow without mutating the local store', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-08-18', type: 'buy', ticker: 'NVDA', currency: 'USD', quantity: 1, price: 100, amount: -100},
        ],
        brokerSummaries: {
            ibkr: {
                ending_cash_by_currency: {USD: '3323.1', CNH: '88.8'},
                position_snapshot_authoritative: true,
                position_snapshot: {
                    QQQI: {quantity: '280'},
                    DRAM: {quantity: '75'},
                    IBKR: {quantity: '3.9179'},
                },
            },
        },
    });
    await page.addInitScript(() => {
        window.localStorage.setItem('antigravity:theme-mode', 'light');
    });
    await page.setViewportSize({width: 825, height: 773});
    await page.goto('/trade/investment');
    await page.evaluate(() => {
        document.documentElement.dataset.themeMode = 'light';
        document.documentElement.setAttribute('data-theme-override', 'light');
        window.dispatchEvent(new CustomEvent('antigravity:theme-mode-change', {
            detail: {mode: 'light'},
        }));
    });
    await page.locator('#toggle_form_button').click();
    const importControlState = await page.locator('.investment-import-control-rail').evaluate((rail) => {
        const openButton = rail.querySelector('#toggle_form_button');
        const closeButton = rail.querySelector('#investment_import_close_button');
        const closeRect = closeButton.getBoundingClientRect();
        const quickActions = document.querySelector('#global_quick_actions');
        const themeButton = document.querySelector('#global_theme_toggle');
        const quickActionsRect = quickActions?.getBoundingClientRect();
        const themeRect = themeButton?.getBoundingClientRect();
        return {
            openDisabled: openButton.disabled,
            openHidden: openButton.hidden,
            closeHidden: closeButton.hidden,
            closeDisabled: closeButton.disabled,
            closeTop: closeRect.top,
            closeBottom: closeRect.bottom,
            closeCenterY: closeRect.top + (closeRect.height / 2),
            closeCenterX: closeRect.left + (closeRect.width / 2),
            railTop: closeRect.top,
            openPointerEvents: getComputedStyle(openButton).pointerEvents,
            globalQuickActionsTop: quickActionsRect?.top,
            globalThemeTop: themeRect?.top,
            globalThemeBottom: themeRect?.bottom,
            globalThemeCenterX: themeRect ? themeRect.left + (themeRect.width / 2) : null,
        };
    });
    expect(importControlState.openDisabled).toBe(true);
    expect(importControlState.openHidden).toBe(true);
    expect(importControlState.closeHidden).toBe(false);
    expect(importControlState.closeDisabled).toBe(false);
    expect(importControlState.closeTop).toBeGreaterThanOrEqual(importControlState.globalThemeBottom + 9);
    expect(Math.abs(importControlState.closeCenterX - importControlState.globalThemeCenterX)).toBeLessThanOrEqual(1);
    expect(Math.abs(importControlState.closeTop - await page.locator('#investment_form').evaluate(
        (form) => form.getBoundingClientRect().top,
    ))).toBeLessThanOrEqual(1);
    expect(importControlState.openPointerEvents).toBe('none');
    const globalThemeToggleState = await page.locator('#global_theme_toggle').evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const hitTarget = document.elementFromPoint(rect.left + (rect.width / 2), rect.top + (rect.height / 2));
        return {
            disabled: button.disabled,
            hitTargetIsButton: hitTarget === button || hitTarget?.closest('#global_theme_toggle') === button,
        };
    });
    expect(globalThemeToggleState.disabled).toBe(false);
    expect(globalThemeToggleState.hitTargetIsButton).toBe(true);
    const sidebarToggleState = await page.locator('#sidebar_toggle').evaluate((button) => ({
        disabled: button.disabled,
        hidden: button.hidden,
        pointerEvents: getComputedStyle(button).pointerEvents,
    }));
    expect(sidebarToggleState.disabled).toBe(true);
    expect(sidebarToggleState.hidden).toBe(true);
    expect(sidebarToggleState.pointerEvents).toBe('none');
    await expect(page.locator('nav.sidebar-dock')).toBeHidden();
    const sectionResizerState = await page.locator('#investment_section_resizer').evaluate((button) => ({
        disabled: button.disabled,
        pointerEvents: getComputedStyle(button).pointerEvents,
    }));
    expect(sectionResizerState.disabled).toBe(true);
    expect(sectionResizerState.pointerEvents).toBe('none');
    await page.locator('#investment_import_broker').evaluate((select) => {
        select.value = 'ibkr';
        select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    const readIbkrImportLayout = () => page.evaluate(() => {
        const container = document.querySelector('#transaction_form_container');
        const csvPanel = document.querySelector(
          '#investment_import_ibkr_fields > [data-ibkr-import-mode-panel="csv"]',
        );
        const actionPackage = document.querySelector('#investment_form > section');
        const scrollStack = document.querySelector('.investment-import-stack');
        if (!container || !csvPanel || !actionPackage || !scrollStack) return null;
        const csvPanelRect = csvPanel.getBoundingClientRect();
        const actionPackageRect = actionPackage.getBoundingClientRect();
        return {
            containerHeight: container.offsetHeight,
            csvGapToAction: actionPackageRect.top - csvPanelRect.bottom,
            scrollTop: scrollStack.scrollTop,
            scrollHeight: scrollStack.scrollHeight,
            clientHeight: scrollStack.clientHeight,
        };
    });
    const csvLayout = await readIbkrImportLayout();
    expect(csvLayout).not.toBeNull();

    await page.locator('#ibkr_import_mode_gainskeeper').evaluate((input) => {
        input.checked = true;
        input.dispatchEvent(new Event('change', {bubbles: true}));
    });
    const gainskeeperModeLayout = await readIbkrImportLayout();
    expect(Math.abs(gainskeeperModeLayout.containerHeight - csvLayout.containerHeight)).toBeLessThanOrEqual(1);

    await page.locator('#ibkr_import_mode_web_paste').evaluate((input) => {
        input.checked = true;
        input.dispatchEvent(new Event('change', {bubbles: true}));
    });
    const webPasteModeLayout = await readIbkrImportLayout();
    expect(Math.abs(webPasteModeLayout.containerHeight - csvLayout.containerHeight)).toBeLessThanOrEqual(1);

    await page.locator('#ibkr_import_mode_csv').evaluate((input) => {
        input.checked = true;
        input.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await page.locator('.investment-import-stack').evaluate((stack) => {
        stack.scrollTop = stack.scrollHeight;
    });
    const scrolledCsvLayout = await readIbkrImportLayout();
    if (scrolledCsvLayout.scrollHeight > scrolledCsvLayout.clientHeight + 1) {
        expect(Math.abs(scrolledCsvLayout.csvGapToAction)).toBeLessThanOrEqual(1);
    } else {
        expect(scrolledCsvLayout.csvGapToAction).toBeGreaterThanOrEqual(-1);
        expect(scrolledCsvLayout.scrollTop).toBe(0);
    }

    await page.setInputFiles('#transactions_csv', fixturePath('ibkr-transactions.csv'));
    await page.setInputFiles('#positions_csv', fixturePath('ibkr-positions.csv'));
    await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
    await expect(page.locator('#transactions_csv_status')).toBeVisible();
    await expect(page.locator('#positions_csv_status')).toBeVisible();

    const transactionHistoryHelpTrigger = page.locator(
      '#investment_import_ibkr_fields [data-import-field="transactions"] .investment-import-label-trigger',
    );
    await transactionHistoryHelpTrigger.hover();
    const transactionHistoryHelp = page.locator(
      '#investment_import_ibkr_fields [data-import-field="transactions"] .investment-import-help',
    );
    await expect(transactionHistoryHelp).toBeVisible();
    const transactionHistoryHelpMaterial = await transactionHistoryHelp.evaluate((tooltip) => {
        const style = getComputedStyle(tooltip);
        return {
            backgroundColor: style.backgroundColor,
            backgroundImage: style.backgroundImage,
            backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
            borderWidth: style.borderTopWidth,
            boxShadow: style.boxShadow,
        };
    });
    expect(transactionHistoryHelpMaterial.backgroundImage).not.toBe('none');
    expect(transactionHistoryHelpMaterial.backdropFilter).toContain('blur');
    expect(transactionHistoryHelpMaterial.borderWidth).not.toBe('0px');
    expect(transactionHistoryHelpMaterial.boxShadow).not.toBe('none');

    await page.locator('[data-shared-select-kind="investment-import-broker"] [data-shared-select-trigger]').click();
    const importPopoverMaterial = await page.locator('#investment_import_broker_dropdown').evaluate((dropdown) => {
        const style = getComputedStyle(dropdown);
        const backgroundAlpha = style.backgroundColor.match(/(?:\/|,)\s*([0-9.]+)\s*\)$/)?.[1];
        return {
            backgroundColor: style.backgroundColor,
            backgroundImage: style.backgroundImage,
            backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
            backgroundAlpha: backgroundAlpha ? Number.parseFloat(backgroundAlpha) : 1,
            isPageLevelOverlayChild: dropdown.parentElement?.matches('[data-shared-select-overlay]') || false,
            position: style.position,
        };
    });
    expect(importPopoverMaterial.backgroundColor).toBe(transactionHistoryHelpMaterial.backgroundColor);
    expect(importPopoverMaterial.backgroundImage).not.toBe('none');
    expect(importPopoverMaterial.backdropFilter).toContain('blur');
    expect(importPopoverMaterial.backgroundAlpha).toBeCloseTo(0.62, 2);
    expect(importPopoverMaterial.backgroundAlpha).toBeLessThan(0.98);
    expect(importPopoverMaterial.isPageLevelOverlayChild).toBe(true);
    expect(importPopoverMaterial.position).toBe('fixed');
    await page.locator('#investment_import_broker_dropdown [role="option"].is-selected').click();
    await expect(page.locator('#investment_import_broker_dropdown')).toBeHidden();

    const importActionPackageMaterial = await page.locator('.investment-import-action-package').evaluate((actionPackage) => {
        const style = getComputedStyle(actionPackage);
        return {
            backgroundColor: style.backgroundColor,
            backgroundImage: style.backgroundImage,
            backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
            borderColor: style.borderTopColor,
            isolation: style.isolation,
            boxShadow: style.boxShadow,
        };
    });
    expect(importActionPackageMaterial.backgroundColor).toBe(transactionHistoryHelpMaterial.backgroundColor);
    expect(importActionPackageMaterial.backgroundImage).not.toBe('none');
    expect(importActionPackageMaterial.backdropFilter).toBe('none');
    expect(importActionPackageMaterial.isolation).toBe('auto');
    expect(importActionPackageMaterial.boxShadow).not.toBe('none');

    const importCardShadows = await page.locator('.investment-import-bridge-field').evaluateAll((cards) => (
        cards.map((card) => getComputedStyle(card).boxShadow)
    ));
    expect(importCardShadows.length).toBeGreaterThan(0);
    expect(importCardShadows.every((shadow) => shadow === 'none')).toBe(true);

    const importScrollGeometry = await page.locator('#transaction_form_container').evaluate((container) => {
        const modal = container.querySelector('#investment_form');
        const stack = container.querySelector('.investment-import-stack');
        const actionPackage = container.querySelector('.investment-import-action-package');
        const controlRail = document.querySelector('.investment-import-control-rail');
        container.scrollTop = container.scrollHeight;
        stack.scrollTop = stack.scrollHeight;
        const containerRect = container.getBoundingClientRect();
        const modalRect = modal.getBoundingClientRect();
        const stackRect = stack.getBoundingClientRect();
        const actionRect = actionPackage.getBoundingClientRect();
        const containerStyle = getComputedStyle(container);
        const modalStyle = getComputedStyle(modal);
        return {
            containerScrollTop: container.scrollTop,
            stackScrollTop: stack.scrollTop,
            stackScrollable: stack.scrollHeight > stack.clientHeight + 1,
            stackOverflowY: getComputedStyle(stack).overflowY,
            containerBoxShadow: getComputedStyle(container).boxShadow,
            containerBackdropFilter: containerStyle.backdropFilter || containerStyle.webkitBackdropFilter,
            containerPosition: containerStyle.position,
            containerEdgeDelta: Math.max(
                Math.abs(containerRect.left),
                Math.abs(containerRect.top),
                Math.abs(window.innerWidth - containerRect.right),
                Math.abs(window.innerHeight - containerRect.bottom),
            ),
            modalCenterDelta: Math.max(
                Math.abs((modalRect.left + (modalRect.width / 2)) - (window.innerWidth / 2)),
                Math.abs((modalRect.top + (modalRect.height / 2)) - (window.innerHeight / 2)),
            ),
            modalWidth: modalRect.width,
            modalHeight: modalRect.height,
            modalBackdropFilter: modalStyle.backdropFilter || modalStyle.webkitBackdropFilter,
            modalRadius: modalStyle.borderTopLeftRadius,
            modalBoxShadow: modalStyle.boxShadow,
            actionBottomGap: Math.abs(modalRect.bottom - actionRect.bottom - 16),
            stackActionGap: actionRect.top - stackRect.bottom,
            controlRailTop: controlRail?.getBoundingClientRect().top,
            closeTop: controlRail?.querySelector('#investment_import_close_button')?.getBoundingClientRect().top,
            closeBottom: controlRail?.querySelector('#investment_import_close_button')?.getBoundingClientRect().bottom,
            modalTop: modalRect.top,
            alignedModalHeight: window.innerHeight - ((controlRail?.getBoundingClientRect().top || 0) * 2),
            controlRailOutsideScrollStack: !stack.contains(controlRail),
            pageScrollLocked: document.body.classList.contains('is-investment-import-modal-open'),
        };
    });
    expect(importScrollGeometry.containerScrollTop).toBe(0);
    if (importScrollGeometry.stackScrollable) {
        expect(importScrollGeometry.stackScrollTop).toBeGreaterThan(0);
        expect(Math.abs(importScrollGeometry.stackActionGap)).toBeLessThanOrEqual(1);
    } else {
        expect(importScrollGeometry.stackScrollTop).toBe(0);
        expect(importScrollGeometry.stackActionGap).toBeGreaterThanOrEqual(-1);
    }
    expect(importScrollGeometry.stackOverflowY).toBe('auto');
    expect(importScrollGeometry.containerBoxShadow).toBe('none');
    expect(importScrollGeometry.containerPosition).toBe('fixed');
    expect(importScrollGeometry.containerEdgeDelta).toBeLessThanOrEqual(1);
    expect(importScrollGeometry.containerBackdropFilter).toContain('blur');
    expect(importScrollGeometry.modalCenterDelta).toBeLessThanOrEqual(1);
    expect(importScrollGeometry.modalWidth).toBeLessThanOrEqual(780);
    expect(importScrollGeometry.modalHeight).toBeGreaterThan(480);
    expect(Math.abs(importScrollGeometry.modalHeight - importScrollGeometry.alignedModalHeight)).toBeLessThanOrEqual(2);
    expect(importScrollGeometry.modalBackdropFilter).toContain('blur');
    expect(importScrollGeometry.modalRadius).not.toBe('0px');
    expect(importScrollGeometry.modalBoxShadow).not.toBe('none');
    expect(importScrollGeometry.actionBottomGap).toBeLessThanOrEqual(1);
    expect(importScrollGeometry.controlRailOutsideScrollStack).toBe(true);
    expect(importScrollGeometry.pageScrollLocked).toBe(true);
    expect(Math.abs(importScrollGeometry.closeTop - importScrollGeometry.modalTop)).toBeLessThanOrEqual(2);
    expect(Math.abs(importScrollGeometry.controlRailTop - importControlState.railTop)).toBeLessThanOrEqual(6);

    await page.locator('#ibkr_import_mode_gainskeeper').evaluate((input) => {
        input.checked = true;
        input.dispatchEvent(new Event('change', {bubbles: true}));
    });
    const gainskeeperLayout = await page.locator('#investment_form').evaluate((form) => {
        const mode = form.querySelector('.investment-import-mode-field');
        const stack = form.querySelector('.investment-import-stack');
        const action = form.querySelector('.investment-import-action-package');
        const stackRect = stack.getBoundingClientRect();
        const actionRect = action.getBoundingClientRect();
        return {
            modeHeight: mode.getBoundingClientRect().height,
            stackActionGap: Math.abs(actionRect.top - stackRect.bottom),
        };
    });
    expect(gainskeeperLayout.modeHeight).toBeLessThan(120);
    expect(gainskeeperLayout.stackActionGap).toBeLessThanOrEqual(1);

    await expect(page.locator('input[name="ibkr_import_mode"]')).toHaveCount(3);
    await page.locator('#ibkr_import_mode_web_paste').evaluate((input) => {
        input.checked = true;
        input.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await expect(page.locator('[data-ibkr-import-mode-panel="web_paste"]')).toBeVisible();
    await expect(page.locator('#ibkr_trade_notifications_text')).toBeEditable();
    await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
    await expect(page.locator('#ibkr_trade_notifications_date')).toHaveAttribute('type', 'hidden');
    await expect(page.getByRole('textbox', {name: 'Type page date'})).toBeVisible();
    await expect(page.locator('[data-ibkr-calibration-table]')).toBeVisible();
    await expect(page.locator('[data-ibkr-calibration-table] thead th')).toHaveText(['No.', 'Asset', 'Cash / quantity']);
    await expect(page.locator('[data-ibkr-calibration-row]')).toHaveCount(5);
    await expect(page.locator('[data-ibkr-calibration-row][data-asset-kind="cash"] .investment-import-calibration-asset')).toHaveText(['Cash (USD)']);
    await page.locator('#ibkr_trade_notifications_text').fill('HKD 1,000.00\nCNY 2,000.00');
    await expect(page.locator('[data-ibkr-calibration-row][data-asset-kind="cash"] .investment-import-calibration-asset')).toHaveText(['Cash (USD)', 'Cash (HKD)', 'Cash (CNH)']);
    await page.locator('#ibkr_trade_notifications_text').fill('');
    await expect(page.locator('[data-ibkr-calibration-row][data-asset-kind="cash"] .investment-import-calibration-asset')).toHaveText(['Cash (USD)']);
    expect(await page.locator('[data-ibkr-calibration-row]').first().locator('td').first().evaluate((cell) => getComputedStyle(cell).textAlign)).toBe('center');
    await expect(page.locator('[data-ibkr-calibration-asset]')).toHaveCount(4);
    expect(await page.locator('[data-ibkr-calibration-asset]').evaluateAll((fields) => fields.map((field) => field.textContent.trim()))).toEqual(['QQQI', 'DRAM', 'IBKR', 'NVDA']);
    await expect(page.locator('select[data-ibkr-calibration-asset]')).toHaveCount(0);
    expect(await page.locator('[data-ibkr-calibration-quantity]').evaluateAll((fields) => fields.map((field) => field.value))).toEqual(['', '', '', '']);
    const calibrationCashFields = page.locator('[data-ibkr-calibration-cash]');
    await calibrationCashFields.first().fill('3323.1');
    await calibrationCashFields.first().blur();
    await expect(calibrationCashFields.first()).toHaveValue('3,323.10');
    await expect(page.locator('#ibkr_trade_notifications_cash')).toHaveValue('3323.1');
    await expect(page.locator('#ibkr_trade_notifications_cash_balances')).toHaveValue('{"USD":"3323.1"}');
    const calibrationQuantityFields = page.locator('[data-ibkr-calibration-quantity]');
    await calibrationQuantityFields.first().fill('1.2');
    await calibrationQuantityFields.first().blur();
    await expect(calibrationQuantityFields.first()).toHaveValue('1.2000');
    await expect(page.locator('#ibkr_trade_notifications_positions')).toHaveValue('QQQI 1.2');
    const stickyImportMode = await page.locator('#investment_import_ibkr_mode').evaluate((mode) => {
        const stack = mode.closest('.investment-import-stack');
        if (!(stack instanceof HTMLElement)) return null;
        const readTop = () => mode.getBoundingClientRect().top;
        stack.scrollTop = 0;
        const initialTop = readTop();
        stack.scrollTop = 180;
        const pinnedTop = readTop();
        stack.scrollTop = 260;
        const pinnedFurtherTop = readTop();
        return {
            position: getComputedStyle(mode).position,
            initialTop,
            pinnedTop,
            pinnedFurtherTop,
            pinnedDelta: Math.abs(pinnedFurtherTop - pinnedTop),
        };
    });
    expect(stickyImportMode).not.toBeNull();
    expect(stickyImportMode.position).toBe('sticky');
    expect(stickyImportMode.pinnedDelta).toBeLessThanOrEqual(1);
    await page.locator('#ibkr_trade_notifications_date').evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                readText: async () => `Orders & Trades\nTrade Notifications\nTrades Account Action Quantity Status Price Amount\nDEMO\nBot 1 @ 10.00 on ARCA\nU00000001 Bought 1\nFilled\n5:00 PM\n10.00\n10\nFees: 0.10\nDEMO\nBot 1 @ 9.50 on ARCA\nU00000001 Bought 1\nFilled\n8/14/2026, 8:00 PM\n9.50\n9.50\nFees: 0.10`,
            },
        });
    });
    await page.locator('#ibkr_trade_notifications_paste_button').click();
    await expect(page.locator('#ibkr_trade_notifications_display')).toHaveValue(/Page date required/);
    await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
    await page.getByRole('textbox', {name: 'Type page date'}).click();
    const ibkrDatePicker = page.locator('.date-picker-popover:not([hidden])');
    await expect(ibkrDatePicker).toBeVisible();
    await ibkrDatePicker.locator('.date-picker-day[data-selectable="true"]').first().click();
    await expect(page.locator('#ibkr_trade_notifications_date')).toHaveValue(/\d{4}-\d{2}-\d{2}/);
    await page.locator('#ibkr_trade_notifications_date').evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                readText: async () => `Orders & Trades\nTrade Notifications\nTrades Account Action Quantity Status Price Amount\nDEMO\nBot 1 @ 10.00 on ARCA\nU00000001 Bought 1\nFilled\n1/2/2025, 8:00 PM\n10.00\n10\nFees: 0.10`,
            },
        });
    });
    await page.locator('#ibkr_trade_notifications_paste_button').click();
    await expect(page.locator('#ibkr_trade_notifications_paste_button')).toHaveClass(/is-pasted/);
    await expect(page.locator('#investment_import_feedback')).toBeHidden();

    await page.route('**/api/investment/imports/zircon-hk/validate', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                message: 'Validated 1 manual investment transaction.',
                transaction_count: 1,
                summary: {transaction_count: 1},
            }),
        });
    });
    await page.locator('#investment_import_broker').evaluate((select) => {
        select.value = 'zircon_hk';
        select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await expect(page.locator('#investment_import_zircon_hk_fields')).toBeVisible();
    await expect(page.locator('#zircon_hk_template_download')).toHaveAttribute(
      'href',
      '/api/investment/imports/zircon-hk/template.xlsx',
    );
    await expect(page.locator('#investment_import_zircon_hk_fields .investment-import-label-step')).toHaveText(['➊', '➋']);
    await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
    await page.setInputFiles(
      '#zircon_hk_transactions_xlsx',
      fixturePath('zircon-hk-valid.xlsx'),
    );
    await expect(page.locator('#zircon_hk_transactions_xlsx_status')).toBeVisible();
    await expect(page.locator('#investment_import_feedback_message')).toContainText(
      'Validated 1 manual investment transaction.',
    );
    await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
    const zirconCardShadows = await page.locator(
      '#investment_import_zircon_hk_fields .investment-import-bridge-field',
    ).evaluateAll((cards) => cards.map((card) => getComputedStyle(card).boxShadow));
    expect(zirconCardShadows).toEqual(['none', 'none']);

    await page.locator('#investment_import_broker').evaluate((select) => {
        select.value = 'standard_xlsx';
        select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await expect(page.locator('#investment_import_zircon_hk_fields')).toBeVisible();
    await expect(page.locator('#investment_import_submit_button')).toBeEnabled();

    for (const broker of [
        'cmb_cn',
        'boc_cn',
        'icbc_cn',
        'icbc_hk',
        'ccb_cn',
        'ccb_hk',
    ]) {
        await page.locator('#investment_import_broker').evaluate((select, selectedBroker) => {
            select.value = selectedBroker;
            select.dispatchEvent(new Event('change', {bubbles: true}));
        }, broker);
        await expect(page.locator('#investment_import_zircon_hk_fields')).toBeVisible();
        await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
    }

    await page.locator('#investment_import_broker').evaluate((select) => {
        select.value = 'boc_hk';
        select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await expect(page.locator('#investment_import_boc_hk_fields')).toBeVisible();
    await expect(page.locator('#investment_import_zircon_hk_fields')).toBeHidden();
    await expect(page.locator('#boc_hk_statement_pdfs')).toBeVisible();
    await expect(page.locator('#boc_hk_statement_pdfs')).toHaveAttribute('type', 'file');
    await expect(page.locator('#boc_hk_statement_pdfs')).toHaveAttribute('multiple', '');
    await expect(page.locator('#boc_hk_statement_pdfs')).toHaveAttribute('accept', '.pdf,application/pdf');
    await expect(page.locator('#boc_hk_statement_pdfs_hint')).toContainText('Select one or more PDFs together');
    await expect(page.locator('#boc_hk_statement_pdfs_hint')).toContainText('HKD Current');
    await expect(page.locator('#boc_hk_statement_pdfs_hint')).toContainText('CNH');
    await expect(page.locator('#boc_hk_statement_pdfs')).toHaveAttribute('required', '');
    await expect(page.locator('#investment_import_submit_button')).toBeDisabled();

    await page.route('**/api/investment/transactions', async (route) => {
        const request = route.request();
        if (request.method() !== 'POST') {
            await route.continue();
            return;
        }
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                message: 'Synthetic BOCHK batch accepted.',
                summary: {},
                freshness_refresh_failures: [],
            }),
        });
    });
    await page.setInputFiles('#boc_hk_statement_pdfs', [
        {
            name: '2026-07.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF-1.7 synthetic july statement'),
        },
        {
            name: '2026-06.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF-1.7 synthetic june statement'),
        },
    ]);
    await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
    const bocHkPostRequestPromise = page.waitForRequest((request) => (
        request.url().includes('/api/investment/transactions')
        && request.method() === 'POST'
    ));
    await page.locator('#investment_import_submit_button').click();
    const bocHkPostRequest = await bocHkPostRequestPromise;
    const multipartBody = bocHkPostRequest.postDataBuffer()?.toString('latin1') || '';
    expect((multipartBody.match(/name="boc_hk_statement_pdfs"/g) || []).length).toBe(2);
    expect(multipartBody.indexOf('2026-07.pdf')).toBeLessThan(multipartBody.indexOf('2026-06.pdf'));
});

test('keeps the Investment import broker dropdown stable while scrolling to HSBC', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [],
        brokerSummaries: {},
    });
    await page.setViewportSize({width: 825, height: 773});
    await page.goto('/trade/investment');
    await page.locator('#toggle_form_button').click();

    const trigger = page.locator('[data-shared-select-kind="investment-import-broker"] [data-shared-select-trigger]');
    const dropdown = page.locator('#investment_import_broker_dropdown');
    await trigger.click();
    await page.waitForTimeout(220);

    await dropdown.hover();
    await page.mouse.wheel(0, 620);
    await expect.poll(() => dropdown.evaluate((menu) => menu.scrollTop)).toBeGreaterThan(0);

    const scrolledGeometry = await dropdown.evaluate((menu) => {
        const rect = menu.getBoundingClientRect();
        return {top: rect.top, left: rect.left, width: rect.width, scrollTop: menu.scrollTop};
    });
    await page.waitForTimeout(150);
    const settledGeometry = await dropdown.evaluate((menu) => {
        const rect = menu.getBoundingClientRect();
        return {top: rect.top, left: rect.left, width: rect.width, scrollTop: menu.scrollTop};
    });
    expect(scrolledGeometry.scrollTop).toBeGreaterThan(0);
    expect(settledGeometry.scrollTop).toBeGreaterThan(0);
    expect(Math.abs(settledGeometry.top - scrolledGeometry.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(settledGeometry.left - scrolledGeometry.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(settledGeometry.width - scrolledGeometry.width)).toBeLessThanOrEqual(1);

    const hsbcOption = dropdown.locator('[role="option"][data-value="hsbc"]');
    await expect(hsbcOption).toBeVisible();
    await hsbcOption.click();
    await expect(dropdown).toBeHidden();
    await expect(page.locator('#investment_import_broker')).toHaveValue('hsbc');
    await expect(page.locator('#investment_import_hsbc_fields')).toBeVisible();
    await expect(page.locator('#hsbc_portfolio_text_display')).toHaveCSS('height', '30px');
    await page.locator('label[for="hsbc_import_mode_statement_pdf"]').click();
    await expect(page.locator('#hsbc_statement_pdfs')).toBeVisible();
    await expect(page.locator('#hsbc_statement_pdfs')).toHaveCSS('font-size', '13px');
    await expect(page.locator('#hsbc_statement_pdfs')).toHaveCSS('height', '30px');
});

test('keeps the IBKR file inputs compact', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [],
        brokerSummaries: {},
    });
    await page.setViewportSize({width: 825, height: 773});
    await page.goto('/trade/investment');
    await page.locator('#toggle_form_button').click();

    const trigger = page.locator('[data-shared-select-kind="investment-import-broker"] [data-shared-select-trigger]');
    const dropdown = page.locator('#investment_import_broker_dropdown');
    await trigger.click();
    await dropdown.locator('[role="option"][data-value="ibkr"]').click();
    await expect(page.locator('#investment_import_ibkr_fields')).toBeVisible();
    await expect(page.locator('#transactions_csv')).toHaveCSS('height', '30px');
    await expect(page.locator('#positions_csv')).toHaveCSS('height', '30px');
    await page.locator('label[for="ibkr_import_mode_gainskeeper"]').click();
    await expect(page.locator('#gainskeeper_files')).toBeVisible();
    await expect(page.locator('#gainskeeper_files')).toHaveCSS('height', '30px');
});

test('shows only pasted-evidence non-USD cash rows in IBKR calibration', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [],
        brokerSummaries: {
            ibkr: {
                ending_cash_by_currency: {USD: '3323.1', HKD: '1000', CNH: '2000'},
                position_snapshot_authoritative: true,
                position_snapshot: {},
            },
        },
    });
    await page.setViewportSize({width: 825, height: 773});
    await page.goto('/trade/investment');
    await page.locator('#toggle_form_button').click();

    const brokerTrigger = page.locator('[data-shared-select-kind="investment-import-broker"] [data-shared-select-trigger]');
    await brokerTrigger.click();
    await page.locator('#investment_import_broker_dropdown [role="option"][data-value="ibkr"]').click();
    await page.locator('label[for="ibkr_import_mode_web_paste"]').click();

    await expect(page.locator('#ibkr_trade_notifications_display')).toHaveCSS('height', '30px');
    await expect(page.locator(
        '#investment_import_ibkr_fields [data-ibkr-import-mode-panel="web_paste"] .investment-import-date-control-row .date-picker-trigger-value'
    )).toHaveCSS('height', '30px');

    const cashAssets = page.locator('[data-ibkr-calibration-row][data-asset-kind="cash"] .investment-import-calibration-asset');
    await expect(cashAssets).toHaveText(['Cash (USD)']);

    await page.locator('#ibkr_trade_notifications_text').evaluate((input) => {
        input.value = 'Portfolio\nHKD 1,000.00\nCNY 2,000.00';
        input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await expect(cashAssets).toHaveText(['Cash (USD)', 'Cash (HKD)', 'Cash (CNH)']);

    await page.locator('#ibkr_trade_notifications_text').evaluate((input) => {
        input.value = '';
        input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await expect(cashAssets).toHaveText(['Cash (USD)']);
});

test('validates HSBC cash-only paste and USD settlement refresh separately from the full snapshot', async ({page}) => {
    await mockInvestmentReadApis(page);
    let releaseHkdValidation;
    const holdHkdValidation = new Promise((resolve) => {
        releaseHkdValidation = resolve;
    });
    let observeHkdValidation;
    const hkdValidationObserved = new Promise((resolve) => {
        observeHkdValidation = resolve;
    });
    await page.route('**/api/investment/imports/hsbc-paste/validate', async (route) => {
        const requestPayload = JSON.parse(route.request().postData() || '{}');
        const cashText = String(requestPayload.cash_account_text || '');
        if (cashText === 'HKD Current page') {
            observeHkdValidation();
            await holdHkdValidation;
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    ready: true,
                    mode: 'cash_only_non_usd',
                    field_status: {cash: true, portfolio: false, order_status: false},
                    cash_currencies: ['HKD'],
                }),
            });
            return;
        }
        if (cashText === 'USD Savings page') {
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    ready: true,
                    mode: 'cash_only_usd',
                    field_status: {cash: true, portfolio: false, order_status: false},
                    cash_currencies: ['USD'],
                }),
            });
            return;
        }
        await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({
                success: false,
                error: 'HSBC cash chunk 1 is not a recognized cash-account page.',
            }),
        });
    });
    await page.goto('/trade/investment');
    await page.locator('#toggle_form_button').click();
    await page.locator('#investment_import_broker').evaluate((select) => {
        select.value = 'hsbc';
        select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await expect(page.locator('#investment_import_hsbc_fields')).toBeVisible();
    await expect(page.locator('[data-hsbc-import-mode-panel="paste"]')).toBeVisible();

    const submitButton = page.locator('#investment_import_submit_button');
    const cashInput = page.locator('#hsbc_cash_account_text');
    const cashStatus = page.locator('#hsbc_cash_account_text_status');
    await cashInput.evaluate((input) => {
        input.value = 'HKD Current page';
        input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await hkdValidationObserved;
    await expect(cashStatus).toHaveClass(/suggestion-loading-spinner/);
    await expect(submitButton).toBeDisabled();

    releaseHkdValidation();
    await expect(cashStatus).toBeVisible();
    await expect(cashStatus).not.toHaveClass(/suggestion-loading-spinner/);
    await expect(submitButton).toBeEnabled();
    await expect(page.locator('#investment_import_feedback_message')).not.toContainText('Validated');

    const cashDisplay = page.locator('#hsbc_cash_account_display');
    const clearButton = page.locator('#hsbc_cash_account_clear_button');
    await cashDisplay.focus();
    await expect(clearButton).toHaveClass(/is-visible/);
    await clearButton.click();
    await expect(cashInput).toHaveValue('');
    await expect(submitButton).toBeDisabled();

    await cashInput.evaluate((input) => {
        input.value = 'USD Savings page';
        input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await expect(cashStatus).toBeVisible();
    await expect(submitButton).toBeEnabled();

    await cashInput.evaluate((input) => {
        input.value = 'Invalid HSBC capture';
        input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await expect(page.locator('#investment_import_feedback_message')).toContainText(
        'not a recognized cash-account page',
    );
    await expect(submitButton).toBeDisabled();
});

test('keeps HSBC page captures on the copy/paste path without local file carriers', async ({page}) => {
    await mockInvestmentReadApis(page);
    await page.goto('/trade/investment');
    await page.locator('#toggle_form_button').click();
    await page.locator('#investment_import_broker').evaluate((select) => {
        select.value = 'hsbc';
        select.dispatchEvent(new Event('change', {bubbles: true}));
    });

    await expect(page.locator('#hsbc_cash_account_file_button')).toHaveCount(0);
    await expect(page.locator('#hsbc_portfolio_text_file_button')).toHaveCount(0);
    await expect(page.locator('#hsbc_order_status_file_button')).toHaveCount(0);
    await expect(page.locator('#hsbc_cash_account_file')).toHaveCount(0);
    await expect(page.locator('#hsbc_portfolio_text_file')).toHaveCount(0);
    await expect(page.locator('#hsbc_order_status_file')).toHaveCount(0);
    await expect(page.locator('#hsbc_cash_account_paste_button')).toBeVisible();
    await expect(page.locator('#hsbc_portfolio_text_paste_button')).toBeVisible();
    await expect(page.locator('#hsbc_order_status_paste_button')).toBeVisible();
});

test('shows HSBC import progress in the workspace modal and final outcome in the banner', async ({page}) => {
    await mockInvestmentReadApis(page);
    await page.route('**/api/investment/imports/hsbc-paste/validate', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                ready: true,
                mode: 'cash_only_non_usd',
                field_status: {cash: true, portfolio: false, order_status: false},
                cash_currencies: ['HKD'],
            }),
        });
    });
    await page.goto('/trade/investment');
    await page.locator('#toggle_form_button').click();
    await page.locator('#investment_import_broker').evaluate((select) => {
        select.value = 'hsbc';
        select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    const cashInput = page.locator('#hsbc_cash_account_text');
    await cashInput.evaluate((input) => {
        input.value = 'HKD Current page';
        input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    const submitButton = page.locator('#investment_import_submit_button');
    await expect(submitButton).toBeEnabled();

    await page.route('**/api/investment/transactions', async (route) => {
        if (route.request().method() !== 'POST') {
            await route.fallback();
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 450));
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                message: 'HSBC cash-only sync complete.',
                summary: {},
                freshness_refresh_failures: [],
            }),
        });
    });

    const feedbackBanner = page.locator('#investment_import_feedback');
    const progressModal = page.locator('#workspace_modal_overlay');
    await submitButton.click();
    await expect(progressModal).toBeVisible();
    await expect(progressModal).toHaveAttribute('role', 'dialog');
    await expect(progressModal.locator('.workspace-modal-title')).toHaveText('Import in progress');
    await expect(feedbackBanner).toBeHidden();
    await expect(progressModal).toBeHidden({timeout: 8000});
    await expect(feedbackBanner).toBeVisible();
    await expect(feedbackBanner.locator('.notice-floating-banner-heading')).toHaveText('HSBC sync complete');
});

test('shows canonical names and security logos for cash-equivalent ETFs', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                date: '2026-07-17',
                type: 'buy',
                ticker: 'GOOGL',
                currency: 'USD',
                quantity: 1,
                price: 346.77,
                amount: -346.77,
            },
            {
                ledger_no: 2,
                broker: 'ibkr',
                date: '2026-07-17',
                type: 'buy',
                ticker: 'SGOV',
                currency: 'USD',
                quantity: 1,
                price: 100.58,
                amount: -100.58,
            },
            {
                ledger_no: 3,
                broker: 'ibkr',
                date: '2026-07-17',
                type: 'buy',
                ticker: 'BOXX',
                currency: 'USD',
                quantity: 1,
                price: 117.08,
                amount: -117.08,
            },
        ],
        tickerProfiles: {
            GOOGL: {
                ticker: 'GOOGL',
                company_name: 'GOOGL',
                logo_url: '/market-store/logos/GOOGL.svg',
            },
            SGOV: {
                ticker: 'SGOV',
                company_name: 'SGOV',
                logo_url: '/market-store/logos/SGOV.svg',
            },
            BOXX: {
                ticker: 'BOXX',
                company_name: 'BOXX',
                logo_url: '/market-store/logos/BOXX.png',
            },
        },
        knownTickerCompanyNames: {
            GOOG: 'Alphabet Inc.',
            GOOGL: 'Alphabet Inc.',
            'GOOG.US': 'Alphabet Inc.',
            'GOOGL.US': 'Alphabet Inc.',
            SGOV: 'iShares 0-3 Month Treasury Bond ETF',
            'SGOV.US': 'iShares 0-3 Month Treasury Bond ETF',
            BOXX: 'Alpha Architect 1-3 Month Box ETF',
            'BOXX.US': 'Alpha Architect 1-3 Month Box ETF',
        },
        moneyMarketTickers: ['005276756'],
        cashEquivalentTickers: ['SGOV', 'BOXX'],
        priceHistoryByTicker: {
            GOOGL: [{date: '2026-07-17', close: 346.77}],
            SGOV: [{date: '2026-07-17', close: 100.58}],
            BOXX: [{date: '2026-07-17', close: 117.08}],
        },
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_holdings"]').click();

    const holding = page.locator(
        '#investment_holdings_panel:not([hidden]) .investment-holdings-table-scroll tr[data-investment-holdings-ticker="GOOGL"]',
    );
    await expect(holding).toHaveCount(1);
    await expect(holding).toBeVisible();
    await expect(holding.locator('.ticker-identity-symbol')).toHaveText('GOOGL');
    await expect(holding.locator('.ticker-identity-name')).toHaveText('Alphabet Inc.');
    await expect(holding.locator('.ticker-identity-name')).toHaveAttribute('title', 'Alphabet Inc.');

    const sgovHolding = page.locator(
        '#investment_holdings_panel:not([hidden]) .investment-holdings-table-scroll tr[data-investment-holdings-ticker="SGOV"]',
    );
    await expect(sgovHolding).toHaveCount(1);
    await expect(sgovHolding.locator('.ticker-identity-name')).toHaveText('iShares 0-3 Month Treasury Bond ETF');
    await expect(sgovHolding.locator('.ticker-identity-name')).toHaveAttribute(
        'title',
        'iShares 0-3 Month Treasury Bond ETF',
    );
    await expect(sgovHolding.locator('img[data-investment-logo-image]')).toHaveAttribute(
        'data-logo-url',
        expect.stringContaining('/market-store/logos/SGOV.svg'),
    );
    await expect(sgovHolding.locator('.investment-cash-equivalent-token-logo')).toHaveCount(0);
    await expect(sgovHolding.locator('.investment-money-market-fund-token-logo')).toHaveCount(0);

    const boxxHolding = page.locator(
        '#investment_holdings_panel:not([hidden]) .investment-holdings-table-scroll tr[data-investment-holdings-ticker="BOXX"]',
    );
    await expect(boxxHolding).toHaveCount(1);
    await expect(boxxHolding.locator('.ticker-identity-name')).toHaveText('Alpha Architect 1-3 Month Box ETF');
    await expect(boxxHolding.locator('img[data-investment-logo-image]')).toHaveAttribute(
        'data-logo-url',
        expect.stringContaining('/market-store/logos/BOXX.png'),
    );
    await expect(boxxHolding.locator('.investment-cash-equivalent-token-logo')).toHaveCount(0);
    await expect(boxxHolding.locator('.investment-money-market-fund-token-logo')).toHaveCount(0);
    const summaryLabels = page.locator(
        '#investment_holdings_panel:not([hidden]) .investment-holdings-summary-metric-label',
    );
    await expect(summaryLabels).toHaveText([
        'Cash',
        'Cash equivalents',
        'Total equity',
        'Cumulative P&L',
    ]);
    const allocationBadges = page.locator(
        '#investment_holdings_panel:not([hidden]) .investment-holdings-allocation-badge [data-investment-live-field]',
    );
    await expect(allocationBadges).toHaveCount(2);
    const totalEquityAllocationTrack = page.locator(
        '#investment_holdings_panel:not([hidden]) .investment-holdings-allocation-track',
    );
    await expect(totalEquityAllocationTrack).toHaveCount(1);
    await expect(totalEquityAllocationTrack).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(page.locator(
        '#investment_holdings_panel:not([hidden]) [data-investment-live-field="summary_cash_allocation"]',
    )).toHaveAttribute('data-investment-live-display', '94.36%');
    await expect(page.locator(
        '#investment_holdings_panel:not([hidden]) [data-investment-live-field="summary_cash_equivalents_allocation"]',
    )).toHaveAttribute('data-investment-live-display', '96.53%');
    await expect(page.locator(
        '#investment_holdings_panel:not([hidden]) [data-investment-live-field="summary_total_equity_allocation"]',
    )).toHaveCount(0);
    const allocationBadgeGeometry = await page.evaluate(() => {
        const badges = Array.from(document.querySelectorAll(
            '#investment_holdings_panel:not([hidden]) .investment-holdings-allocation-badge',
        ));
        return badges.map((badge) => {
            const badgeRect = badge.getBoundingClientRect();
            const integer = badge.querySelector('.workspace-metric-value-major');
            const decimal = badge.querySelector('.workspace-metric-value-minor');
            const suffix = badge.querySelector('.workspace-metric-value-suffix');
            const decimalRect = badge.querySelector('.workspace-metric-value-minor')?.getBoundingClientRect();
            const suffixRect = badge.querySelector('.workspace-metric-value-suffix')?.getBoundingClientRect();
            const textBottom = (element, start, end) => {
                const glyphs = Array.from(
                    element?.querySelectorAll('.investment-holdings-allocation-badge-glyph') || [],
                ).slice(start, end);
                if (!glyphs.length) return null;
                return Math.max(...glyphs.map((glyph) => glyph.getBoundingClientRect().bottom));
            };
            const style = getComputedStyle(badge);
            return {
                right: badgeRect.right,
                width: badgeRect.width,
                overflows: badge.scrollWidth > badge.clientWidth,
                decimalLeft: decimalRect?.left ?? null,
                suffixRight: suffixRect?.right ?? null,
                integerBottom: textBottom(integer, 0, integer?.textContent?.length ?? 0),
                decimalPointBottom: textBottom(decimal, 0, 1),
                decimalDigitsBottom: textBottom(decimal, 1, decimal?.textContent?.length ?? 0),
                suffixBottom: textBottom(suffix, 0, suffix?.textContent?.length ?? 0),
                backgroundColor: style.backgroundColor,
                borderRadius: style.borderRadius,
                color: style.color,
            };
        });
    });
    expect(allocationBadgeGeometry).toHaveLength(2);
    expect(Math.max(...allocationBadgeGeometry.map((badge) => badge.right)) - Math.min(...allocationBadgeGeometry.map((badge) => badge.right))).toBeLessThanOrEqual(1);
    allocationBadgeGeometry.forEach((badge) => {
        expect(badge.width).toBeGreaterThanOrEqual(52);
        expect(badge.width).toBeLessThan(110);
        expect(badge.overflows).toBe(false);
    });
    expect(Math.max(...allocationBadgeGeometry.map((badge) => badge.decimalLeft)) - Math.min(...allocationBadgeGeometry.map((badge) => badge.decimalLeft))).toBeLessThanOrEqual(1);
    expect(Math.max(...allocationBadgeGeometry.map((badge) => badge.suffixRight)) - Math.min(...allocationBadgeGeometry.map((badge) => badge.suffixRight))).toBeLessThanOrEqual(1);
    allocationBadgeGeometry.forEach((badge) => {
        const bottoms = [badge.integerBottom, badge.decimalPointBottom, badge.decimalDigitsBottom, badge.suffixBottom];
        expect(bottoms.every((bottom) => Number.isFinite(bottom))).toBe(true);
        expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThanOrEqual(1);
        expect(badge.backgroundColor).toBe('rgb(22, 163, 74)');
        expect(badge.borderRadius).toBe('2px');
        expect(badge.color).toBe('rgb(255, 255, 255)');
    });
    await expect(page.locator(
        '#investment_holdings_panel:not([hidden]) .investment-holdings-allocation-badge-positive',
    )).toHaveCount(2);
    const firstAllocationBadge = page.locator(
        '#investment_holdings_panel:not([hidden]) .investment-holdings-allocation-badge',
    ).first();
    await page.locator('html').evaluate((root) => {
        root.setAttribute('data-theme-override', 'dark');
    });
    await expect(firstAllocationBadge).toHaveCSS('background-color', 'rgb(47, 255, 156)');
    await expect(firstAllocationBadge).toHaveCSS('color', 'rgb(11, 12, 12)');
    await page.locator('html').evaluate((root) => {
        root.setAttribute('data-theme-override', 'light');
    });
    await expect(firstAllocationBadge).toHaveCSS('background-color', 'rgb(22, 163, 74)');
    await expect(firstAllocationBadge).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect.poll(() => page.evaluate(() => {
        const values = Array.from(document.querySelectorAll(
            '#investment_holdings_panel:not([hidden]) .investment-holdings-summary-metric-row > [data-investment-live-field]',
        ));
        if (values.length !== 4) return null;
        const rightEdges = values.map((value) => value.getBoundingClientRect().right);
        return Math.max(...rightEdges) - Math.min(...rightEdges);
    })).toBeLessThanOrEqual(1);
    await page.locator(
        '#investment_holdings_panel:not([hidden]) .investment-holdings-summary-metric-row > [data-investment-live-field]',
    ).evaluateAll((values) => {
        values.forEach((value, index) => {
            value.style.minWidth = `${52 + (index * 13)}px`;
        });
    });
    await expect.poll(() => page.evaluate(() => {
        const values = Array.from(document.querySelectorAll(
            '#investment_holdings_panel:not([hidden]) .investment-holdings-summary-metric-row > [data-investment-live-field]',
        ));
        const rightEdges = values.map((value) => value.getBoundingClientRect().right);
        return Math.max(...rightEdges) - Math.min(...rightEdges);
    })).toBeLessThanOrEqual(1);
    const summaryCash = page.locator(
        '#investment_holdings_panel:not([hidden]) [data-investment-live-field="summary_cash_balance"]',
    );
    const summaryCashEquivalents = page.locator(
        '#investment_holdings_panel:not([hidden]) [data-investment-live-field="summary_cash_equivalents"]',
    );
    await expect(summaryCashEquivalents).toHaveAttribute('data-investment-live-display', '9,653.23');
    expect(Number(await summaryCashEquivalents.getAttribute('data-investment-live-number'))).toBeCloseTo(
        Number(await summaryCash.getAttribute('data-investment-live-number')) + 100.58 + 117.08,
        8,
    );
});

test('renders every calendar day in the long-range Investment equity chart', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {ledger_no: 1, broker: 'ibkr', date: '2026-01-08', type: 'buy', ticker: 'ABC', currency: 'USD', quantity: 1, price: 100, amount: -100},
            {ledger_no: 2, broker: 'ibkr', date: '2026-01-10', type: 'deposit', currency: 'USD', amount: 10},
            {ledger_no: 3, broker: 'ibkr', date: '2026-01-12', type: 'adjustment', currency: 'USD', amount: 0},
        ],
        priceHistoryByTicker: {
            ABC: [
                {date: '2026-01-09', close: 100},
                {date: '2026-01-12', close: 110},
            ],
        },
    });
    await page.goto('/trade/investment?range=3m');
    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        return chart?.data?.rawLabels || null;
    }), {timeout: 30_000}).toEqual([
        '2026-01-08',
        '2026-01-09',
        '2026-01-10',
        '2026-01-11',
        '2026-01-12',
    ]);
    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const values = chart?.data?.datasets?.[0]?.data || [];
        return values.length >= 5 ? values.slice(-3) : null;
    }), {timeout: 30_000}).toEqual([10010, 10010, 10020]);
});

test('shows daily price and P&L badges below open-position values', async ({page}) => {
    const sessionDate = '2026-07-28';
    const shiftDate = (date, dayOffset) => {
        const shifted = new Date(`${date}T12:00:00Z`);
        shifted.setUTCDate(shifted.getUTCDate() + dayOffset);
        return shifted.toISOString().slice(0, 10);
    };
    const priorDate = shiftDate(sessionDate, -1);
    const openingDate = shiftDate(sessionDate, -2);
    await mockInvestmentReadApis(page, {
        transactions: [
            {ledger_no: 1, broker: 'ibkr', date: openingDate, type: 'buy', ticker: 'TQQQ', currency: 'USD', quantity: 2, price: 100, amount: -200},
            {ledger_no: 2, broker: 'ibkr', date: sessionDate, type: 'sell', ticker: 'TQQQ', currency: 'USD', quantity: 1, price: 110, amount: 110},
            {ledger_no: 3, broker: 'ibkr', date: openingDate, type: 'buy', ticker: 'ZERO', currency: 'USD', quantity: 1, price: 50, amount: -50},
            {ledger_no: 4, broker: 'ibkr', date: openingDate, type: 'buy', ticker: 'LOSS', currency: 'USD', quantity: 2, price: 50, amount: -100},
            {ledger_no: 5, broker: 'ibkr', date: sessionDate, type: 'sell', ticker: 'LOSS', currency: 'USD', quantity: 1, price: 40, amount: 40},
        ],
        priceHistoryByTicker: {
            TQQQ: [
                {date: priorDate, close: 105},
                {date: sessionDate, close: 112},
            ],
            ZERO: [
                {date: priorDate, close: 50},
                {date: sessionDate, close: 50},
            ],
            LOSS: [
                {date: priorDate, close: 45},
                {date: sessionDate, close: 35},
            ],
        },
        marketSession: {
            session: 'overnight',
            is_trading_day: true,
            is_realtime_allowed: true,
            session_date: sessionDate,
        },
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_holdings"]').click();

    const holding = page.locator(
        '#investment_holdings_panel:not([hidden]) .investment-holdings-table-scroll tr[data-investment-holdings-ticker="TQQQ"]',
    );
    const lastPriceBadge = holding.locator('[data-investment-live-field="daily_last_price"]');
    const realizedBadge = holding.locator('[data-investment-live-field="daily_realized_pnl"]');
    const unrealizedBadge = holding.locator('[data-investment-live-field="daily_unrealized_pnl"]');
    await expect(page.locator('#investment_holdings_panel:not([hidden]) th').filter({hasText: 'Last price'})).toHaveCount(1);
    await expect(lastPriceBadge).toHaveAttribute('data-investment-live-display', '+7.00');
    await expect(realizedBadge).toHaveAttribute('data-investment-live-display', '+10.00');
    await expect(unrealizedBadge).toHaveAttribute('data-investment-live-display', '+7.00');
    await expect(lastPriceBadge.locator('..')).toHaveCSS('background-color', 'rgb(22, 163, 74)');
    await expect(realizedBadge.locator('..')).toHaveCSS('background-color', 'rgb(22, 163, 74)');
    await expect(unrealizedBadge.locator('..')).toHaveCSS('background-color', 'rgb(22, 163, 74)');

    const summaryRow = page.locator(
        '#investment_holdings_panel:not([hidden]) .investment-holdings-summary-row',
    );
    const summaryRealizedBadge = summaryRow.locator(
        '[data-investment-live-field="summary_daily_realized_pnl"]',
    );
    const summaryUnrealizedBadge = summaryRow.locator(
        '[data-investment-live-field="summary_daily_unrealized_pnl"]',
    );
    await expect(summaryRealizedBadge).toHaveAttribute('data-investment-live-display', '0.00');
    await expect(summaryRealizedBadge.locator('..')).toBeHidden();
    await expect(summaryUnrealizedBadge).toHaveAttribute('data-investment-live-display', '-3.00');
    await expect(summaryUnrealizedBadge.locator('..')).toHaveCSS('background-color', 'rgb(255, 47, 146)');
    const summaryUnrealizedDecimalAlignment = await summaryRow.evaluate((row) => {
        const values = Array.from(
            row.cells.item(7)?.querySelectorAll('.workspace-metric-value-minor') || [],
        );
        return values.map((value) => value.getBoundingClientRect().left);
    });
    expect(summaryUnrealizedDecimalAlignment).toHaveLength(2);
    expect(Math.abs(
        summaryUnrealizedDecimalAlignment[0] - summaryUnrealizedDecimalAlignment[1],
    )).toBeLessThanOrEqual(1);

    const decimalAlignment = await holding.evaluate((row) => [3, 6, 7].map((cellIndex) => {
        const cell = row.cells.item(cellIndex);
        const values = Array.from(cell?.querySelectorAll('.workspace-metric-value-minor') || []);
        return values.map((value) => value.getBoundingClientRect().left);
    }));
    decimalAlignment.forEach((leftEdges) => {
        expect(leftEdges).toHaveLength(2);
        expect(Math.abs(leftEdges[0] - leftEdges[1])).toBeLessThanOrEqual(1);
    });
    const adaptiveBadgeGeometry = await holding.evaluate((row) => {
        const realized = row.querySelector('[data-investment-live-field="daily_realized_pnl"]')?.parentElement;
        const unrealized = row.querySelector('[data-investment-live-field="daily_unrealized_pnl"]')?.parentElement;
        return {
            realizedWidth: realized?.getBoundingClientRect().width ?? 0,
            unrealizedWidth: unrealized?.getBoundingClientRect().width ?? 0,
        };
    });
    expect(adaptiveBadgeGeometry.realizedWidth).toBeGreaterThan(adaptiveBadgeGeometry.unrealizedWidth);

    const zeroHolding = page.locator(
        '#investment_holdings_panel:not([hidden]) .investment-holdings-table-scroll tr[data-investment-holdings-ticker="ZERO"]',
    );
    const zeroBadges = zeroHolding.locator('.investment-holdings-daily-pnl-badge:visible');
    await expect(zeroBadges).toHaveCount(2);
    const zeroRealizedValue = zeroHolding.locator('td').nth(6).locator('.trade-metric-value').first();
    await expect(zeroRealizedValue).toHaveText('0.00');
    await expect(zeroRealizedValue).toHaveClass(/investment-holdings-value-neutral/);
    for (const field of ['daily_last_price', 'daily_realized_pnl', 'daily_unrealized_pnl']) {
        const zeroBadge = zeroHolding.locator(`[data-investment-live-field="${field}"]`);
        await expect(zeroBadge).toHaveAttribute('data-investment-live-display', '0.00');
        if (field === 'daily_realized_pnl') {
            await expect(zeroBadge.locator('..')).toBeHidden();
        } else {
            await expect(zeroBadge.locator('..')).toBeVisible();
            await expect(zeroBadge.locator('..')).toHaveClass(/investment-holdings-daily-pnl-badge-neutral/);
            await expect(zeroBadge.locator('..')).not.toHaveCSS('background-color', 'rgb(80, 90, 95)');
        }
    }
    const zeroNeutralBadge = zeroHolding.locator(
        '.investment-holdings-daily-pnl-badge-neutral',
    ).first();
    await page.locator('html').evaluate((root) => {
        root.setAttribute('data-theme-override', 'light');
    });
    await expect(zeroNeutralBadge).toHaveCSS('color', 'rgb(255, 255, 255)');
    await page.locator('html').evaluate((root) => {
        root.setAttribute('data-theme-override', 'dark');
    });
    await expect(zeroNeutralBadge).toHaveCSS('color', 'rgb(11, 12, 12)');
    await page.locator('html').evaluate((root) => {
        root.setAttribute('data-theme-override', 'light');
    });

    const lossHolding = page.locator(
        '#investment_holdings_panel:not([hidden]) .investment-holdings-table-scroll tr[data-investment-holdings-ticker="LOSS"]',
    );
    const lossBadges = lossHolding.locator('.investment-holdings-daily-pnl-badge-negative');
    await expect(lossBadges).toHaveCount(3);
    await expect(lossHolding.locator('[data-investment-live-field="daily_last_price"]')).toHaveAttribute(
        'data-investment-live-display',
        '-10.00',
    );
    await expect(lossHolding.locator('[data-investment-live-field="daily_realized_pnl"]')).toHaveAttribute(
        'data-investment-live-display',
        '-10.00',
    );
    await expect(lossHolding.locator('[data-investment-live-field="daily_unrealized_pnl"]')).toHaveAttribute(
        'data-investment-live-display',
        '-10.00',
    );
});

test('hides live Holdings change badges while the ticker market is closed', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {ledger_no: 1, broker: 'ibkr', date: '2026-08-06', type: 'buy', ticker: 'TQQQ', currency: 'USD', quantity: 1, price: 100, amount: -100},
        ],
        priceHistoryByTicker: {
            TQQQ: [
                {date: '2026-08-06', close: 100},
                {date: '2026-08-07', close: 100},
            ],
        },
        marketSession: {
            session: 'off',
            is_trading_day: false,
            is_realtime_allowed: false,
            session_date: '2026-08-07',
        },
    });
    await page.goto('/trade/investment?view=holdings');

    const holding = page.locator(
        '#investment_holdings_panel:not([hidden]) .investment-holdings-table-scroll tr[data-investment-holdings-ticker="TQQQ"]',
    );
    await expect(holding.locator('[data-investment-live-field="last"]')).toBeVisible();
    await expect(holding.locator('[data-investment-live-field="unrealized_pnl"]')).toBeVisible();
    for (const field of ['daily_last_price', 'daily_unrealized_pnl']) {
        const badgeValue = holding.locator(`[data-investment-live-field="${field}"]`);
        await expect(badgeValue).toHaveAttribute('data-investment-live-display', '0.00');
        await expect(badgeValue.locator('..')).toBeHidden();
    }

    const summaryBadge = page.locator(
        '#investment_holdings_panel:not([hidden]) [data-investment-live-field="summary_daily_unrealized_pnl"]',
    );
    await expect(summaryBadge).toHaveAttribute('data-investment-live-display', '0.00');
    await expect(summaryBadge.locator('..')).toBeHidden();
});

test('keeps Holdings live-value geometry stable and fixed summary cumulative P&L free of a daily badge', async ({page}) => {
    await page.addInitScript(() => {
        const RealDate = Date;
        const fixedTimestamp = new RealDate('2026-07-22T14:00:00Z').valueOf();
        class FixedDate extends RealDate {
            constructor(...args) {
                super(...(args.length ? args : [fixedTimestamp]));
            }

            static now() {
                return fixedTimestamp;
            }
        }
        window.Date = FixedDate;

        const nativeSetTimeout = window.setTimeout.bind(window);
        window.setTimeout = (callback, delay, ...args) => {
            if (delay === 60_000 && typeof callback === 'function') {
                window.__testTriggerInvestmentHoldingsRealtimePoll = () => callback(...args);
                return 0;
            }
            return nativeSetTimeout(callback, delay, ...args);
        };
    });
    const tickers = ['TST1', 'TST2', 'TST3', 'TST4', 'TST5'];
    let quotePrice = 100;
    const realtimeQuotes = () => tickers.map((ticker) => ({
        ticker,
        price: quotePrice,
        timestamp: '2026-07-22 10:00',
        session: 'intraday',
        session_date: '2026-07-22',
        market: 'US',
        source: 'yfinance',
    }));
    await mockInvestmentReadApis(page, {
        transactions: tickers.map((ticker, index) => ({
            ledger_no: index + 1,
            broker: 'ibkr',
            date: '2026-07-21',
            type: 'buy',
            ticker,
            currency: 'USD',
            quantity: 1,
            price: 110,
            amount: -110,
        })),
        priceHistoryByTicker: Object.fromEntries(
            tickers.map((ticker) => [ticker, [{date: '2026-07-21', close: 99}]]),
        ),
        realtimeQuotes,
        marketSession: {
            session: 'intraday',
            is_trading_day: true,
            is_realtime_allowed: true,
            session_date: '2026-07-22',
        },
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_holdings"]').click();

    const summaryRow = page.locator(
        '#investment_holdings_panel:not([hidden]) .investment-holdings-summary-row',
    );
    const cumulativePnl = summaryRow.locator('[data-investment-live-field="summary_cumulative_pnl"]');
    const dailyNetPnl = summaryRow.locator('[data-investment-live-field="summary_daily_cumulative_pnl"]');
    await expect(cumulativePnl).toHaveAttribute('data-investment-live-display', '-50.00');
    await expect(dailyNetPnl).toHaveCount(0);

    const readStableLiveValueGeometry = () => page.evaluate(() => {
        const panel = document.querySelector('#investment_holdings_panel:not([hidden])');
        const shell = panel?.querySelector('.investment-holdings-table-shell');
        const table = panel?.querySelector('[data-table-body]');
        const row = panel?.querySelector(
            '[data-table-scroll] tr[data-investment-holdings-ticker="TST1"]',
        );
        const readRect = (element) => {
            const rect = element?.getBoundingClientRect();
            return rect ? {width: rect.width, height: rect.height} : null;
        };
        return {
            shell: readRect(shell),
            table: readRect(table),
            row: readRect(row),
            last: readRect(row?.querySelector('[data-investment-live-field="last"]')),
            marketValue: readRect(row?.querySelector('[data-investment-live-field="market_value"]')),
            unrealizedPnl: readRect(row?.querySelector('[data-investment-live-field="unrealized_pnl"]')),
            positionWeight: readRect(row?.querySelector('[data-investment-live-field="position_weight"]')),
            summaryCumulativePnl: readRect(
                panel?.querySelector('[data-investment-live-field="summary_cumulative_pnl"]'),
            ),
        };
    });
    const initialGeometry = await readStableLiveValueGeometry();

    const dailyHoldingBadges = page.locator(
        '#investment_holdings_panel:not([hidden]) [data-table-scroll] tr[data-investment-holdings-ticker] [data-investment-live-field="daily_unrealized_pnl"]',
    );
    await expect(dailyHoldingBadges).toHaveCount(5);
    for (let index = 0; index < 5; index += 1) {
        await expect(dailyHoldingBadges.nth(index)).toHaveAttribute('data-investment-live-display', '+1.00');
    }

    quotePrice = 1_000;
    await expect.poll(() => page.evaluate(() => (
        typeof window.__testTriggerInvestmentHoldingsRealtimePoll
    ))).toBe('function');
    await page.evaluate(() => window.__testTriggerInvestmentHoldingsRealtimePoll());
    await expect(cumulativePnl).toHaveAttribute('data-investment-live-display', '+4,450.00');
    await expect(dailyNetPnl).toHaveCount(0);
    for (let index = 0; index < 5; index += 1) {
        await expect(dailyHoldingBadges.nth(index)).toHaveAttribute('data-investment-live-display', '+901.00');
    }
    const updatedGeometry = await readStableLiveValueGeometry();
    for (const key of Object.keys(initialGeometry)) {
        expect(updatedGeometry[key]?.width, `${key} width`).toBeCloseTo(initialGeometry[key]?.width, 1);
        expect(updatedGeometry[key]?.height, `${key} height`).toBeCloseTo(initialGeometry[key]?.height, 1);
    }
});

test('keeps converted broker rewards as a compact final Holdings row and includes them in realized P&L', async ({page}) => {
    const passiveHoldings = Array.from({length: 12}, (_, index) => ({
        ledger_no: index + 6,
        broker: 'ibkr',
        date: '2026-07-05',
        type: 'buy',
        ticker: `TEST${index + 1}`,
        currency: 'USD',
        quantity: 1,
        price: 1,
        amount: -1,
    }));
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                date: '2026-07-01',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 1,
                price: 100,
                amount: -100,
            },
            {
                ledger_no: 2,
                broker: 'ibkr',
                date: '2026-07-02',
                type: 'sell',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 1,
                price: 110,
                amount: 110,
            },
            {
                ledger_no: 3,
                broker: 'ibkr',
                date: '2026-07-02',
                type: 'forex_trade_component',
                ticker: 'USD.HKD',
                currency: 'USD',
                price: 7.8,
                amount: 10,
            },
            {
                ledger_no: 4,
                broker: 'longbridge_sg',
                date: '2026-07-03',
                type: 'kol_reward',
                currency: 'HKD',
                amount: 78,
                description: 'KOL Rewards',
            },
            {
                ledger_no: 5,
                broker: 'tigertrade',
                date: '2026-07-04',
                type: 'kol_reward',
                currency: 'USD',
                amount: 5,
                description: 'Coupon Rebate',
            },
            ...passiveHoldings,
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-07-01', close: 100},
                {date: '2026-07-02', close: 110},
            ],
        },
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_holdings"]').click();

    const bodyRows = page.locator(
        '#investment_holdings_panel:not([hidden]) .investment-holdings-table-scroll tbody > tr',
    );
    await expect(bodyRows).toHaveCount(14);
    const rewardRow = bodyRows.last();
    await expect(rewardRow).toHaveAttribute('data-investment-broker-rewards-row', '');
    await expect(rewardRow.locator('.ticker-identity-symbol')).toHaveText('Broker rewards');
    await expect(rewardRow.locator('.ticker-identity-name')).toHaveText('Coupons, cash rewards & KOL rewards');
    await expect(rewardRow.locator('.investment-broker-reward-token-logo')).toHaveCSS(
        'background-color',
        'rgb(22, 163, 74)',
    );
    await expect(rewardRow.locator('td').nth(6)).toHaveText('15.00');
    await expect(rewardRow.locator('td').nth(6)).toHaveClass(/investment-holdings-value-positive/);
    await expect(rewardRow.locator('td').nth(7)).toHaveText('-');

    await expect(rewardRow.locator('td').first()).toHaveCSS('position', 'static');
    await expect(page.locator('#investment_holdings_panel .local-store-pagination')).toHaveCount(0);
    const rewardRowGeometry = await rewardRow.evaluate((row) => {
        const rowRect = row.getBoundingClientRect();
        const copy = row.querySelector('.ticker-identity-copy');
        const symbol = row.querySelector('.ticker-identity-symbol');
        const name = row.querySelector('.ticker-identity-name');
        const symbolRect = symbol?.getBoundingClientRect();
        const nameRect = name?.getBoundingClientRect();
        return {
            height: rowRect.height,
            copyDisplay: copy ? getComputedStyle(copy).display : '',
            nameMarginTop: name ? getComputedStyle(name).marginTop : '',
            symbolAndNameShareLine: Boolean(
                symbolRect
                && nameRect
                && symbolRect.top < nameRect.bottom
                && nameRect.top < symbolRect.bottom
            ),
        };
    });
    expect(rewardRowGeometry.height).toBeLessThanOrEqual(34);
    expect(rewardRowGeometry.copyDisplay).toBe('flex');
    expect(rewardRowGeometry.nameMarginTop).toBe('0px');
    expect(rewardRowGeometry.symbolAndNameShareLine).toBe(true);

    const summaryRealized = page.locator(
        '#investment_holdings_panel:not([hidden]) .investment-holdings-summary-row td',
    ).nth(6);
    await expect(summaryRealized).toContainText('25.00');

    await page.locator('label[for="investment_view_metrics"]').click();
    const realizedMetric = page.locator(
        '#investment_metrics_panel:not([hidden]) .trade-metric-card',
    ).filter({has: page.getByText('Realized P&L', {exact: true})});
    await expect(realizedMetric).toContainText('25.00');
});

test('keeps Investment Metrics disclosures current, readable, and viewport-safe', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'longbridge_hk', date: '2026-07-08', type: 'forex_trade_component', ticker: 'USD.HKD', currency: 'USD', price: 7.8, amount: 10},
            {broker: 'longbridge_hk', date: '2026-07-09', type: 'forex_trade_component', ticker: 'USD.CNH', currency: 'USD', price: 7.2, amount: 10},
            {broker: 'ibkr', date: '2026-07-10', type: 'deposit', currency: 'USD', amount: 1_000},
            {broker: 'ibkr', date: '2026-07-11', type: 'buy', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 100, amount: -100},
            {broker: 'ibkr', date: '2026-07-12', type: 'sell', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 110, amount: 110},
            {broker: 'longbridge_hk', date: '2026-07-13', type: 'deposit', currency: 'HKD', amount: 78, description: 'Coupon Rebate', source: {transaction_type_raw: 'KOL'}},
            {broker: 'longbridge_hk', date: '2026-07-14', type: 'deposit', currency: 'USD', amount: 5, description: 'Coupon Rebate', source: {transaction_type_raw: 'KOL'}},
            {broker: 'longbridge_hk', date: '2026-07-15', type: 'deposit', currency: 'CNH', amount: 72, description: 'Cash Coupon', source: {transaction_type_raw: 'KOL'}},
            {broker: 'longbridge_hk', date: '2026-07-16', type: 'deposit', currency: 'USD', amount: 10, description: 'Cash Coupon', source: {transaction_type_raw: 'KOL'}},
        ],
        priceHistoryByTicker: {
            AAPL: [
                {date: '2026-07-11', close: 100},
                {date: '2026-07-12', close: 110},
            ],
        },
    });
    await page.setViewportSize({width: 856, height: 769});
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_metrics"]').click();

    const metricsPanel = page.locator('#investment_metrics_panel:not([hidden])');
    await expect(metricsPanel).toBeVisible();
    await expect(metricsPanel.getByText('Total gain', {exact: true})).toHaveCount(0);
    await expect(metricsPanel.getByText(/offshore/i)).toHaveCount(0);

    const rewardsCard = metricsPanel.locator('.trade-metric-card').filter({
        has: page.getByText('Coupon rebates / Cash rewards', {exact: true}),
    });
    await expect(rewardsCard).toHaveCount(1);
    await expect(rewardsCard.locator('.trade-metric-value')).toHaveText('35.00');
    await expect(metricsPanel.getByText('Coupon rebates HKD', {exact: true})).toHaveCount(0);
    await expect(metricsPanel.getByText('Coupon rebates USD', {exact: true})).toHaveCount(0);
    await expect(metricsPanel.getByText('Cash rewards HKD', {exact: true})).toHaveCount(0);
    await expect(metricsPanel.getByText('Cash rewards USD', {exact: true})).toHaveCount(0);

    const rewardsTrigger = rewardsCard.locator('[data-investment-metric-breakdown-trigger]');
    const rewardsBreakdown = rewardsCard.locator('.investment-stock-details-metric-breakdown');
    await expect(rewardsBreakdown).toBeHidden();
    await rewardsCard.hover();
    await expect(rewardsTrigger).toHaveCSS('opacity', '1');
    await rewardsTrigger.click();
    await expect(rewardsTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(rewardsTrigger).toHaveAttribute('aria-label', 'Hide Coupon rebates / Cash rewards details');
    await expect(rewardsBreakdown).toBeVisible();
    await expect(rewardsBreakdown).toContainText('Coupon rebates · HKD');
    await expect(rewardsBreakdown).toContainText('HKD 78.00');
    await expect(rewardsBreakdown).toContainText('Coupon rebates · USD');
    await expect(rewardsBreakdown).toContainText('Cash rewards · CNH');
    await expect(rewardsBreakdown).toContainText('CNH 72.00');
    await expect(rewardsBreakdown).toContainText('Cash rewards · USD');

    const rewardsAlignment = await rewardsCard.evaluate((card) => {
        const readHorizontalBounds = (element) => {
            const rect = element?.getBoundingClientRect();
            return rect ? {left: rect.left, right: rect.right} : null;
        };
        return {
            card: readHorizontalBounds(card),
            summaryValue: readHorizontalBounds(card.querySelector('.investment-metric-value-row .trade-metric-value')),
            detailRows: Array.from(card.querySelectorAll('.investment-stock-details-metric-breakdown-row'))
                .map(readHorizontalBounds),
            detailValues: Array.from(card.querySelectorAll('.investment-stock-details-metric-breakdown-value'))
                .map(readHorizontalBounds),
        };
    });
    expect(rewardsAlignment.card).not.toBeNull();
    expect(rewardsAlignment.summaryValue).not.toBeNull();
    expect(Math.abs(rewardsAlignment.summaryValue.left - rewardsAlignment.card.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(rewardsAlignment.summaryValue.right - rewardsAlignment.card.right)).toBeLessThanOrEqual(1);
    for (const detailRow of rewardsAlignment.detailRows) {
        expect(detailRow).not.toBeNull();
        expect(Math.abs(detailRow.left - rewardsAlignment.card.left)).toBeLessThanOrEqual(1);
        expect(Math.abs(detailRow.right - rewardsAlignment.card.right)).toBeLessThanOrEqual(1);
    }
    for (const detailValue of rewardsAlignment.detailValues) {
        expect(detailValue).not.toBeNull();
        expect(Math.abs(detailValue.right - rewardsAlignment.card.right)).toBeLessThanOrEqual(1);
    }

    const metricTrigger = metricsPanel.locator('[data-metric-key="cumulative-pnl"]');
    await expect(metricTrigger).toHaveCount(1);
    await metricTrigger.click();

    const tooltip = page.locator('#investment_metric_tooltip_cumulative-pnl');
    await expect(tooltip).toHaveClass(/is-visible/);
    await expect.poll(() => tooltip.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
    await expect(tooltip).toContainText('Calculation');
    await expect(tooltip).toContainText('Contributing ledger rows');
    await expect(tooltip).toContainText('Stock-grant P&L');

    const geometry = await metricTrigger.evaluate((trigger) => {
        const tooltipElement = document.getElementById('investment_metric_tooltip_cumulative-pnl');
        const tooltipRect = tooltipElement?.getBoundingClientRect();
        const copyRect = tooltipElement?.querySelector('.investment-metric-tooltip-copy')?.getBoundingClientRect();
        const rowNoRect = tooltipElement?.querySelector('.investment-metric-tooltip-row-no')?.getBoundingClientRect();
        const panel = document.getElementById('investment_metrics_panel');
        const styles = tooltipElement ? getComputedStyle(tooltipElement) : null;
        return {
            isBodyChild: tooltipElement?.parentElement === document.body,
            position: styles?.position || '',
            opacity: styles?.opacity || '',
            ariaDescribedBy: trigger.getAttribute('aria-describedby') || '',
            ariaHidden: tooltipElement?.getAttribute('aria-hidden') || '',
            tooltipWithinViewport: Boolean(
                tooltipRect
                && tooltipRect.left >= 0
                && tooltipRect.top >= 0
                && tooltipRect.right <= window.innerWidth
                && tooltipRect.bottom <= window.innerHeight,
            ),
            copyWithinTooltip: Boolean(copyRect && tooltipRect && copyRect.right <= tooltipRect.right + 1),
            rowNumberSingleLine: Boolean(rowNoRect && rowNoRect.height < 20),
            metricsOverflowY: panel ? getComputedStyle(panel).overflowY : '',
        };
    });

    expect(geometry).toMatchObject({
        isBodyChild: true,
        position: 'fixed',
        opacity: '1',
        ariaHidden: 'false',
        tooltipWithinViewport: true,
        copyWithinTooltip: true,
        rowNumberSingleLine: true,
        metricsOverflowY: 'auto',
    });
    expect(geometry.ariaDescribedBy).toBe('investment_metric_tooltip_cumulative-pnl');
});

test('expands broker-scoped Unrealized P&L into open-position contributions', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc'],
        transactions: [
            {
                broker: 'hsbc',
                account: 'HSBC-1',
                date: '2026-07-10',
                type: 'buy',
                ticker: 'DRAM',
                currency: 'USD',
                quantity: 2,
                price: 100,
                amount: -200,
            },
            {
                broker: 'hsbc',
                account: 'HSBC-1',
                date: '2026-07-11',
                type: 'buy',
                ticker: 'EUV',
                currency: 'USD',
                quantity: 1,
                price: 200,
                amount: -200,
            },
        ],
        priceHistoryByTicker: {
            DRAM: [
                {date: '2026-07-10', close: 100},
                {date: '2026-07-11', close: 110},
            ],
            EUV: [
                {date: '2026-07-11', close: 200},
                {date: '2026-07-12', close: 190},
            ],
        },
    });
    await page.goto('/trade/investment?view=metrics&metrics-broker=hsbc&broker=hsbc');

    const unrealizedCard = page.locator('#investment_metrics_panel [data-metric-key="unrealized-pnl"]');
    const trigger = unrealizedCard.locator('[data-investment-metric-breakdown-trigger]');
    const breakdown = unrealizedCard.locator('.investment-stock-details-metric-breakdown');

    await expect(unrealizedCard.locator('.trade-metric-value')).toContainText('+10.00');
    await expect(trigger).toHaveAttribute('aria-label', 'Show Unrealized P&L details');
    await expect(breakdown).toBeHidden();
    await unrealizedCard.hover();
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(trigger).toHaveAttribute('aria-label', 'Hide Unrealized P&L details');
    await expect(breakdown).toBeVisible();
    await expect(breakdown.locator('.investment-stock-details-metric-breakdown-row')).toHaveCount(2);
    await expect(breakdown).toContainText('DRAM');
    await expect(breakdown).toContainText('+20.00');
    await expect(breakdown).toContainText('EUV');
    await expect(breakdown).toContainText('-10.00');
});

test('preserves HKD funding evidence when calculating USD funding Metrics', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['zircon_hk'],
        transactions: [
            {
                ledger_no: 1,
                broker: 'zircon_hk',
                account: 'HK-1',
                date: '2026-07-01',
                type: 'deposit',
                currency: 'HKD',
                amount: 25_000,
                description: 'Deposit',
            },
            {
                ledger_no: 2,
                broker: 'zircon_hk',
                account: 'HK-1',
                date: '2026-07-02',
                type: 'forex_trade_component',
                currency: 'HKD',
                amount: -650,
                description: 'FX from HKD to USD',
                source: {forex_pair_reference_id: 'zircon-fx-20260702-001'},
            },
            {
                ledger_no: 3,
                broker: 'zircon_hk',
                account: 'HK-1',
                date: '2026-07-02',
                type: 'forex_trade_component',
                currency: 'USD',
                amount: 83.22,
                description: 'FX from HKD to USD',
                source: {forex_pair_reference_id: 'zircon-fx-20260702-001'},
            },
        ],
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_metrics"]').click();

    const metricsPanel = page.locator('#investment_metrics_panel:not([hidden])');
    const metricCard = (label) => metricsPanel.locator('.trade-metric-card').filter({
        has: page.getByText(label, {exact: true}),
    });
    await expect(metricCard('Direct deposits')).toContainText('3,117.55');
    await expect(metricCard('Net USD converted')).toContainText('83.22');
    await expect(metricCard('Final investable USD')).toContainText('3,200.77');
    await expect(metricCard('Direct deposits')).not.toContainText('25,000.00');
});

test('splits realized P&L into spread, income, interest, and fee categories in USD', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                account: 'U-1',
                date: '2026-07-10',
                type: 'buy',
                ticker: 'AAPL',
                currency: 'USD',
                quantity: 10,
                price: 10,
                amount: -100,
                commission: 1,
            },
            {
                ledger_no: 2,
                broker: 'ibkr',
                account: 'U-1',
                date: '2026-07-11',
                type: 'sell',
                ticker: 'AAPL',
                currency: 'USD',
                quantity: 10,
                price: 15,
                amount: 150,
                commission: 1,
            },
            {
                ledger_no: 3,
                broker: 'ibkr',
                account: 'U-1',
                date: '2026-07-12',
                type: 'dividend',
                ticker: 'AAPL',
                currency: 'USD',
                amount: 2,
            },
            {
                ledger_no: 4,
                broker: 'ibkr',
                account: 'U-1',
                date: '2026-07-12',
                type: 'foreign_tax_withholding',
                ticker: 'AAPL',
                currency: 'USD',
                amount: -0.3,
            },
            {
                ledger_no: 5,
                broker: 'ibkr',
                account: 'U-1',
                date: '2026-07-13',
                type: 'debit_interest',
                currency: 'USD',
                amount: -0.7,
                description: 'Margin interest',
            },
            {
                ledger_no: 6,
                broker: 'ibkr',
                account: 'U-1',
                date: '2026-07-14',
                type: 'fee',
                currency: 'USD',
                amount: -0.2,
                description: 'Account fee',
            },
        ],
        priceHistoryByTicker: {
            AAPL: [
                {date: '2026-07-10', close: 10},
                {date: '2026-07-11', close: 15},
            ],
        },
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_metrics"]').click();

    const metricsPanel = page.locator('#investment_metrics_panel:not([hidden])');
    const realizedCard = metricsPanel.locator('[data-metric-key="realized-pnl"]');
    const realizedBreakdown = realizedCard.locator('.investment-stock-details-metric-breakdown');
    await expect(realizedCard.locator('.trade-metric-value')).toContainText('+48.80');
    await realizedCard.hover();
    await realizedCard.locator('[data-investment-metric-breakdown-trigger]').click();
    await expect(realizedBreakdown).toBeVisible();
    await expect(realizedBreakdown).toContainText('Trading spread gains');
    await expect(realizedBreakdown).toContainText('+50.00');
    await expect(realizedBreakdown).toContainText('Dividends, net of withholding');
    await expect(realizedBreakdown).toContainText('+1.70');
    await expect(realizedBreakdown).toContainText('Interest charged');
    await expect(realizedBreakdown).toContainText('-0.70');
    await expect(realizedBreakdown).toContainText('Commissions / fees');
    await expect(realizedBreakdown).toContainText('-2.20');
    await expect(realizedBreakdown).not.toContainText('Broker-reported reconciliation');

    await page.locator('label[for="investment_view_holdings"]').click();
    const holdingsRealized = page.locator(
        '#investment_holdings_panel .investment-holdings-summary-row td',
    ).nth(6);
    await expect(holdingsRealized).toContainText('48.80');
});

test('shows Zircon (HK) cut losses from a lower sell price in Metrics', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['zircon_hk'],
        transactions: [
            {
                broker: 'zircon_hk',
                account: '57812160',
                date: '2026-07-10',
                type: 'buy',
                ticker: 'SPYM',
                currency: 'USD',
                quantity: 1,
                price: 71,
                amount: -71,
            },
            {
                broker: 'zircon_hk',
                account: '57812160',
                date: '2026-07-11',
                type: 'sell',
                ticker: 'SPYM',
                currency: 'USD',
                quantity: 1,
                price: 69.61,
                amount: 69.61,
            },
        ],
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_metrics"]').click();

    const brokerSelector = page.locator('#investment_metrics_panel_shell [data-investment-broker-filter-trigger]');
    await brokerSelector.click();
    await page.getByRole('option', {name: 'Zircon (HK)', exact: true}).click();

    const realizedCard = page.locator('#investment_metrics_panel [data-metric-key="realized-pnl"]');
    await realizedCard.hover();
    await realizedCard.locator('[data-investment-metric-breakdown-trigger]').click();
    const realizedBreakdown = realizedCard.locator('.investment-stock-details-metric-breakdown');
    await expect(realizedBreakdown).toContainText('Cut losses');
    await expect(realizedBreakdown).toContainText('-1.39');
});

test('synchronizes Investment Metrics and history by broker', async ({page}) => {
    const exportRequests = [];
    await page.route('**/api/investment/exports/standard.xlsx', async (route) => {
        exportRequests.push(route.request().postDataJSON());
        const response = await route.fetch();
        const body = await response.body();
        expect(response.status()).toBe(200);
        expect(response.headers()['content-type']).toContain(
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
        await route.fulfill({response, body});
    });
    await mockInvestmentReadApis(page, {
        brokers: ['ibkr', 'hsbc'],
        transactions: [
            {broker: 'ibkr', date: '2026-07-10', type: 'buy', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 100, amount: -100},
            {broker: 'hsbc', date: '2026-07-11', type: 'buy', ticker: 'MSFT', currency: 'USD', quantity: 1, price: 200, amount: -200},
            {broker: 'hsbc', date: '2026-07-12', type: 'sell', ticker: 'MSFT', currency: 'USD', quantity: 1, price: 215, amount: 215},
            {broker: 'ibkr', date: '2026-07-13', type: 'sell', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 110, amount: 110},
        ],
        priceHistoryByTicker: {
            AAPL: [
                {date: '2026-07-10', close: 100},
                {date: '2026-07-13', close: 110},
            ],
            MSFT: [
                {date: '2026-07-11', close: 200},
                {date: '2026-07-12', close: 215},
            ],
        },
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_metrics"]').click();

    const metricsShell = page.locator('#investment_metrics_panel_shell:not([hidden])');
    const metricsPanel = page.locator('#investment_metrics_panel');
    await expect(metricsShell).toBeVisible();
    await expect(metricsShell.locator('.investment-metrics-copy')).toHaveCount(0);
    const metricsBrokerField = metricsShell.locator('.investment-broker-summary-selector-shell');
    await expect(metricsBrokerField).toHaveClass(/live-trading-broker-strip/);
    await expect(metricsBrokerField).toHaveClass(/backtest-shared-select-field/);
    await expect(metricsBrokerField).toHaveClass(/investment-import-broker-field/);
    const brokerSelector = metricsShell.locator('[data-investment-broker-filter-trigger]');
    const brokerSelectorLogo = brokerSelector.locator('[data-investment-broker-filter-logo]');
    await expect(brokerSelector).toHaveAttribute('aria-label', 'Brokers selector: All');
    await expect(brokerSelectorLogo).toBeHidden();

    const cumulativeMetric = metricsPanel.locator('.trade-metric-card').filter({
        has: page.getByText('Cumulative P&L', {exact: true}),
    });
    await expect(cumulativeMetric).toContainText('25.00');
    await cumulativeMetric.locator('[data-metric-key="cumulative-pnl"]').click();
    await expect(page.locator('#investment_metric_tooltip_cumulative-pnl')).toHaveClass(/is-visible/);
    const historyRows = page.locator('#investment_history tr[data-investment-history-row]');
    const historyBrokerSelector = page.locator('#history_table_wrap [data-investment-broker-filter-trigger]');
    await expect(historyRows).toHaveCount(4);

    const exportVisibleStandardXlsx = async (expectedFilename) => {
        await page.locator('#investment_share_actions > .export-transactions-button').hover();
        const standardXlsxButton = page.locator('#export_standard_xlsx_button');
        await expect(standardXlsxButton).toHaveCSS('pointer-events', 'auto');
        const downloadPromise = page.waitForEvent('download');
        await standardXlsxButton.click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toBe(expectedFilename);
        const downloadPath = await download.path();
        expect(downloadPath).not.toBeNull();
        const downloadedBytes = await readFile(downloadPath);
        expect(downloadedBytes.length).toBeGreaterThan(2);
        expect(downloadedBytes.subarray(0, 2).toString('ascii')).toBe('PK');
    };

    await exportVisibleStandardXlsx('Standard_investment_export.xlsx');
    assertCompleteStandardInvestmentExportPayload(exportRequests[0], ['ibkr', 'hsbc']);
    expect(exportRequests[0].transactions).toHaveLength(4);

    await brokerSelector.click();
    await expect(page.getByRole('option')).toHaveCount(3);
    await expect.poll(() => page.getByRole('option').evaluateAll((options) => options.filter((option) => (
        option.getAttribute('aria-selected') === 'true'
    )).length)).toBe(1);
    await page.getByRole('option', {name: 'HSBC', exact: true}).click();
    await expect(brokerSelector).toHaveAttribute('aria-label', 'Brokers selector: HSBC');
    await expect(brokerSelectorLogo).toHaveAttribute('src', '/market-store/logos/brokers/HSBC.png');
    await expect(brokerSelectorLogo).toBeVisible();
    await expect(page.locator('#investment_metric_tooltip_cumulative-pnl')).not.toHaveClass(/is-visible/);
    await expect(cumulativeMetric).toContainText('15.00');

    await expect(historyBrokerSelector).toHaveAttribute('aria-label', 'Broker filter: HSBC');
    await expect(historyRows).toHaveCount(2);
    await expect.poll(() => historyRows.evaluateAll((rows) => rows.map((row) => (
        row.querySelector('.investment-history-broker-cell')?.textContent?.trim() || ''
    )))).toEqual(['HSBC', 'HSBC']);
    await expect(page).toHaveURL(/view=metrics.*metrics-broker=hsbc.*broker=hsbc/);

    await exportVisibleStandardXlsx('MSFT_standard_investment_export.xlsx');
    assertCompleteStandardInvestmentExportPayload(exportRequests[1], ['hsbc']);
    expect(exportRequests[1].transactions).toHaveLength(2);

    await brokerSelector.click();
    await page.getByRole('option', {name: 'IBKR', exact: true}).click();
    await expect(brokerSelector).toHaveAttribute('aria-label', 'Brokers selector: IBKR');
    await expect(brokerSelectorLogo).toHaveAttribute('src', '/market-store/logos/brokers/IBKR.png');
    await expect(brokerSelectorLogo).toBeVisible();

    await expect(cumulativeMetric).toContainText('10.00');
    await expect(historyBrokerSelector).toHaveAttribute('aria-label', 'Broker filter: IBKR');
    await expect(historyRows).toHaveCount(2);
    await expect.poll(() => historyRows.evaluateAll((rows) => rows.map((row) => (
        row.querySelector('.investment-history-broker-cell')?.textContent?.trim() || ''
    )))).toEqual(['IBKR', 'IBKR']);
    await expect(page).toHaveURL(/view=metrics.*metrics-broker=ibkr.*broker=ibkr/);

    await exportVisibleStandardXlsx('AAPL_standard_investment_export.xlsx');
    assertCompleteStandardInvestmentExportPayload(exportRequests[2], ['ibkr']);
    expect(exportRequests[2].transactions).toHaveLength(2);

    await historyBrokerSelector.click();
    await expect.poll(() => page.getByRole('option').evaluateAll((options) => options.filter((option) => (
        option.getAttribute('aria-selected') === 'true'
    )).length)).toBe(1);
    await page.getByRole('option', {name: 'HSBC', exact: true}).click();
    await expect(brokerSelector).toHaveAttribute('aria-label', 'Brokers selector: HSBC');
    await expect(historyBrokerSelector).toHaveAttribute('aria-label', 'Broker filter: HSBC');
    await expect(historyRows).toHaveCount(2);
    await expect(cumulativeMetric).toContainText('15.00');
    await expect(page).toHaveURL(/view=metrics.*metrics-broker=hsbc.*broker=hsbc/);

    await historyBrokerSelector.click();
    await page.getByRole('option', {name: 'All', exact: true}).click();
    await expect(brokerSelector).toHaveAttribute('aria-label', 'Brokers selector: All');
    await expect(historyBrokerSelector).toHaveAttribute('aria-label', 'Broker filter: All brokers');
    await expect(historyRows).toHaveCount(4);
    await expect(brokerSelectorLogo).toBeHidden();
    await expect(brokerSelectorLogo).not.toHaveAttribute('src', /.+/);
    await expect(cumulativeMetric).toContainText('25.00');
    await expect(historyRows).toHaveCount(4);
    await expect(page).not.toHaveURL(/[?&](?:metrics-)?broker=/);

    await exportVisibleStandardXlsx('Standard_investment_export.xlsx');
    assertCompleteStandardInvestmentExportPayload(exportRequests[3], ['ibkr', 'hsbc']);
    expect(exportRequests[3].transactions).toHaveLength(4);
});

test('keeps the shared Metrics broker scope local and restores it on return', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['boc_hk', 'hsbc'],
        transactions: [
            {broker: 'boc_hk', date: '2026-07-10', type: 'buy', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 100, amount: -100},
            {broker: 'hsbc', date: '2026-07-11', type: 'buy', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 110, amount: -110},
            {broker: 'boc_hk', date: '2026-07-12', type: 'sell', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 120, amount: 120},
            {broker: 'hsbc', date: '2026-07-13', type: 'sell', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 130, amount: 130},
        ],
        priceHistoryByTicker: {
            AAPL: [
                {date: '2026-07-10', close: 100},
                {date: '2026-07-11', close: 110},
                {date: '2026-07-12', close: 120},
                {date: '2026-07-13', close: 130},
            ],
        },
    });

    await page.goto('/trade/investment?view=metrics&metrics-broker=boc_hk&broker=boc_hk');

    const topBroker = page.locator('#investment_metrics_panel_shell [data-investment-broker-filter-trigger]');
    const lowerBroker = page.locator('#history_table_wrap [data-investment-broker-filter-trigger]');
    const historyRows = page.locator('#investment_history tr[data-investment-history-row]');
    await expect(topBroker).toHaveAttribute('aria-label', 'Brokers selector: Bank of China (Hong Kong)');
    await expect(lowerBroker).toHaveAttribute('aria-label', 'Broker filter: Bank of China (Hong Kong)');
    await expect(historyRows).toHaveCount(2);

    await topBroker.click();
    await expect.poll(() => page.getByRole('option').evaluateAll((options) => options.filter((option) => (
        option.getAttribute('aria-selected') === 'true'
    )).length)).toBe(1);
    await page.getByRole('option', {name: 'Bank of China (Hong Kong)', exact: true}).click();
    await expect(topBroker).toHaveAttribute('aria-label', 'Brokers selector: Bank of China (Hong Kong)');

    await lowerBroker.click();
    await page.getByRole('option', {name: 'HSBC', exact: true}).click();
    await expect(lowerBroker).toHaveAttribute('aria-label', 'Broker filter: HSBC');
    await expect(topBroker).toHaveAttribute('aria-label', 'Brokers selector: HSBC');
    await expect(historyRows).toHaveCount(2);
    await expect(page).toHaveURL(/view=metrics.*metrics-broker=hsbc.*broker=hsbc/);

    await topBroker.click();
    await page.getByRole('option', {name: 'All', exact: true}).click();
    await expect(topBroker).toHaveAttribute('aria-label', 'Brokers selector: All');
    await expect(lowerBroker).toHaveAttribute('aria-label', 'Broker filter: All brokers');
    await expect(historyRows).toHaveCount(4);

    await topBroker.click();
    await page.getByRole('option', {name: 'Bank of China (Hong Kong)', exact: true}).click();
    await expect(topBroker).toHaveAttribute('aria-label', 'Brokers selector: Bank of China (Hong Kong)');
    await expect(lowerBroker).toHaveAttribute('aria-label', 'Broker filter: Bank of China (Hong Kong)');
    await expect(historyRows).toHaveCount(2);

    await page.locator('label[for="investment_view_chart"]').click();
    await expect(page).toHaveURL(/view=overview/);
    await expect(page).not.toHaveURL(/metrics-broker|broker=hsbc/);
    await expect(lowerBroker).toHaveAttribute('aria-label', 'Broker filter: All brokers');
    await expect(historyRows).toHaveCount(4);

    await page.reload();
    await expect(lowerBroker).toHaveAttribute('aria-label', 'Broker filter: All brokers');
    await expect(historyRows).toHaveCount(4);

    await page.locator('label[for="investment_view_holdings"]').click();
    await expect(lowerBroker).toHaveAttribute('aria-label', 'Broker filter: All brokers');
    await expect(historyRows).toHaveCount(4);

    await page.locator('label[for="investment_view_stock_details"]').click();
    await expect(page.locator('#investment_stock_details_table_host')).toBeVisible();
    await expect(lowerBroker).toHaveAttribute('aria-label', 'Broker filter: All brokers');
    await expect(page.locator('#investment_stock_details_table_host tr[data-investment-stock-detail-ledger]')).toHaveCount(4);

    await page.locator('label[for="investment_view_metrics"]').click();
    await expect(topBroker).toHaveAttribute('aria-label', 'Brokers selector: Bank of China (Hong Kong)');
    await expect(lowerBroker).toHaveAttribute('aria-label', 'Broker filter: Bank of China (Hong Kong)');
    await expect(historyRows).toHaveCount(2);

    await lowerBroker.click();
    await page.getByRole('option', {name: 'All', exact: true}).click();
    await expect(topBroker).toHaveAttribute('aria-label', 'Brokers selector: All');
    await expect(lowerBroker).toHaveAttribute('aria-label', 'Broker filter: All brokers');
    await expect(historyRows).toHaveCount(4);
});

test('keeps Overview and Stock details ranges isolated and remembered', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['boc_hk', 'hsbc'],
        transactions: [
            {broker: 'boc_hk', date: '2026-04-10', type: 'buy', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 100, amount: -100},
            {broker: 'hsbc', date: '2026-07-10', type: 'buy', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 110, amount: -110},
        ],
        priceHistoryByTicker: {
            AAPL: [
                {date: '2026-04-10', close: 100},
                {date: '2026-07-10', close: 110},
            ],
        },
    });

    await page.goto('/trade/investment?view=overview');
    await page.locator('label[for="investment_equity_range_3m"]').click();
    await expect(page.locator('#investment_equity_range_3m')).toBeChecked();
    await expect(page).toHaveURL(/view=overview.*range=3m/);

    await page.locator('label[for="investment_view_metrics"]').click();
    await expect(page).toHaveURL(/view=metrics/);
    await expect(page).not.toHaveURL(/range=/);

    await page.locator('label[for="investment_view_stock_details"]').click();
    await expect(page.locator('#investment_stock_details_range_max')).toBeChecked();
    await page.locator('label[for="investment_stock_details_range_1w"]').click();
    await expect(page.locator('#investment_stock_details_range_1w')).toBeChecked();
    await expect(page).toHaveURL(/view=stock-details.*range=1w/);

    await page.locator('label[for="investment_view_chart"]').click();
    await expect(page.locator('#investment_equity_range_3m')).toBeChecked();
    await expect(page).toHaveURL(/view=overview.*range=3m/);

    await page.locator('label[for="investment_view_stock_details"]').click();
    await expect(page.locator('#investment_stock_details_range_1w')).toBeChecked();
    await expect(page).toHaveURL(/view=stock-details.*range=1w/);

    await page.locator('label[for="investment_view_metrics"]').click();
    await expect(page).toHaveURL(/view=metrics/);
    await expect(page).not.toHaveURL(/range=/);
});

test('renders restored Hong Kong bank names and logos from a direct Metrics URL', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['cmb_hk', 'standard_chartered_hk', 'welab_bank'],
        transactions: [
            {
                ledger_no: 1,
                broker: 'cmb_hk',
                date: '2026-07-01',
                type: 'deposit',
                currency: 'HKD',
                amount: 100,
                description: 'CMB HK deposit',
            },
            {
                ledger_no: 2,
                broker: 'standard_chartered_hk',
                date: '2026-07-02',
                type: 'deposit',
                currency: 'HKD',
                amount: 200,
                description: 'Standard Chartered deposit',
            },
            {
                ledger_no: 3,
                broker: 'welab_bank',
                date: '2026-07-03',
                type: 'deposit',
                currency: 'HKD',
                amount: 300,
                description: 'WeLab deposit',
            },
        ],
    });

    await page.goto('/trade/investment?view=metrics&metrics-broker=standard_chartered_hk&broker=standard_chartered_hk');

    const metricsShell = page.locator('#investment_metrics_panel_shell:not([hidden])');
    const brokerSelector = metricsShell.locator('[data-investment-broker-filter-trigger]');
    const brokerSelectorLogo = brokerSelector.locator('[data-investment-broker-filter-logo]');
    const historyBrokerSelector = page.locator('#history_table_wrap [data-investment-broker-filter-trigger]');
    const historyRows = page.locator('#investment_history tr[data-investment-history-row]');
    await expect(brokerSelector).toHaveAttribute('aria-label', 'Brokers selector: Standard Chartered (HK)');
    await expect(historyBrokerSelector).toHaveAttribute('aria-label', 'Broker filter: Standard Chartered (HK)');
    await expect(brokerSelectorLogo).toHaveAttribute(
        'src',
        '/market-store/logos/brokers/Standard%20Chartered.svg',
    );
    await expect(brokerSelectorLogo).toBeVisible();
    await expect(historyRows).toHaveCount(1);
    await expect(historyRows.first().locator('.investment-history-broker-logo')).toHaveAttribute(
        'src',
        '/market-store/logos/brokers/Standard%20Chartered.svg',
    );

    await brokerSelector.click();
    await page.getByRole('option', {name: 'WeLab Bank', exact: true}).click();
    await expect(brokerSelector).toHaveAttribute('aria-label', 'Brokers selector: WeLab Bank');
    await expect(historyBrokerSelector).toHaveAttribute('aria-label', 'Broker filter: WeLab Bank');
    await expect(brokerSelectorLogo).toHaveAttribute(
        'src',
        '/market-store/logos/brokers/WeLab%20Bank.png',
    );
    await expect(brokerSelectorLogo).toBeVisible();
    await expect(historyRows).toHaveCount(1);
    await expect(historyRows.first().locator('.investment-history-broker-logo')).toHaveAttribute(
        'src',
        '/market-store/logos/brokers/WeLab%20Bank.png',
    );
    await expect(page).toHaveURL(/view=metrics.*metrics-broker=welab_bank.*broker=welab_bank/);

    await brokerSelector.click();
    await page.getByRole('option', {name: 'China Merchants Bank Hong Kong Branch', exact: true}).click();
    await expect(brokerSelector).toHaveAttribute(
        'aria-label',
        'Brokers selector: China Merchants Bank Hong Kong Branch',
    );
    await expect(historyBrokerSelector).toHaveAttribute(
        'aria-label',
        'Broker filter: China Merchants Bank Hong Kong Branch',
    );
    await expect(brokerSelectorLogo).toHaveAttribute(
        'src',
        '/market-store/logos/brokers/CMB%20Wing%20Lung.svg',
    );
    await expect(brokerSelectorLogo).toBeVisible();
    await expect(historyRows).toHaveCount(1);
    await expect(historyRows.first().locator('.investment-history-broker-logo')).toHaveAttribute(
        'src',
        '/market-store/logos/brokers/CMB%20Wing%20Lung.svg',
    );
    await expect(page).toHaveURL(/view=metrics.*metrics-broker=cmb_hk.*broker=cmb_hk/);
});

test('keeps Investment view, range, broker scope, and pagination in the canonical URL', async ({page}) => {
    const transactions = Array.from({length: 205}, (_, index) => ({
        broker: 'hsbc',
        date: '2026-07-10',
        type: 'sell',
        ticker: 'AAPL',
        currency: 'USD',
        quantity: 1,
        price: 100 + index,
        amount: 100 + index,
    }));
    transactions.push({
        broker: 'ibkr',
        date: '2026-07-10',
        type: 'sell',
        ticker: 'AAPL',
        currency: 'USD',
        quantity: 1,
        price: 99,
        amount: 99,
    });
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'ibkr'],
        transactions,
        priceHistoryByTicker: {
            AAPL: [
                {date: '2026-07-10', close: 100},
                {date: '2026-07-11', close: 101},
            ],
        },
    });

    await page.goto('/trade/investment?view=overview&range=3m&broker=hsbc&type=sell&page=2');
    await expect(page).toHaveURL(/view=overview.*range=3m.*broker=hsbc.*type=sell.*page=2/);
    await expect(page.locator('#investment_history tr[data-investment-history-row]')).toHaveCount(100);

    await page.locator('label[for="investment_view_metrics"]').click();
    await expect(page).toHaveURL(/view=metrics.*type=sell/);
    await expect(page).not.toHaveURL(/[?&]broker=hsbc(?:&|$)/);
    const metricsBroker = page.locator('#investment_metrics_panel_shell [data-investment-broker-filter-trigger]');
    await metricsBroker.click();
    await page.getByRole('option', {name: 'HSBC', exact: true}).click();
    await expect(page).toHaveURL(/view=metrics.*metrics-broker=hsbc.*broker=hsbc.*type=sell/);

    await metricsBroker.click();
    await page.getByRole('option', {name: 'All', exact: true}).click();
    await expect(page).toHaveURL(/view=metrics.*type=sell/);
    await expect(page).not.toHaveURL(/[?&](?:metrics-)?broker=hsbc(?:&|$)/);

    await page.locator('label[for="investment_view_chart"]').click();
    await expect(page).toHaveURL(/view=overview.*range=3m.*broker=hsbc.*type=sell/);

    await page.goto('/trade/investment?view=stock-details&ticker=AAPL&range=3m&broker=hsbc&type=sell');
    await expect(page).toHaveURL(/view=stock-details.*ticker=AAPL.*range=3m.*broker=hsbc.*type=sell/);
    await expect(page.locator('#investment_stock_details_table_host')).toBeVisible();
    await expect(page.locator('.investment-stock-details-price-chart-canvas')).toBeVisible();
});

test('keeps China Merchants Bank KOL income in CNY while valuing it in USD', async ({page}) => {
    const cnyRewards = [
        ['2023-09-28', 3_845.10],
        ['2023-10-31', 3_354.48],
        ['2023-11-29', 1_868.80],
        ['2023-12-29', 2_922.24],
        ['2024-01-30', 1_816.80],
        ['2024-02-29', 1_924.23],
        ['2024-03-29', 5_780.25],
    ];
    await mockInvestmentReadApis(page, {
        brokers: ['cmb_cn'],
        transactions: [
            ...cnyRewards.map(([date, amount], index) => ({
                ledger_no: index + 1,
                broker: 'cmb_cn',
                date,
                type: 'kol_reward',
                currency: 'CNY',
                amount,
                description: 'Longbridge KOL Reward',
            })),
            {
                ledger_no: 8,
                broker: 'cmb_cn',
                date: '2024-04-01',
                type: 'virtual_balance_reset',
                currency: 'CNY',
                amount: -21_511.90,
                description: 'Manual virtual balance reset to CNY 0.00',
                source: {virtual_balance_reset_not_real_world_transaction: true},
            },
        ],
        fxRateHistoryByCurrency: {
            CNY: {
                dates: cnyRewards.map(([date]) => date),
                values: Object.fromEntries(cnyRewards.map(([date]) => [date, 7])),
            },
        },
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_metrics"]').click();

    const metricsShell = page.locator('#investment_metrics_panel_shell:not([hidden])');
    const brokerSelector = metricsShell.locator('[data-investment-broker-filter-trigger]');
    const brokerSelectorLogo = brokerSelector.locator('[data-investment-broker-filter-logo]');
    await brokerSelector.click();
    await page.getByRole('option', {name: 'China Merchants Bank', exact: true}).click();
    await expect(brokerSelector).toHaveAttribute('aria-label', 'Brokers selector: China Merchants Bank');
    await expect(brokerSelectorLogo).toHaveAttribute(
        'src',
        '/market-store/logos/brokers/CMB%20Wing%20Lung.svg',
    );

    const metricsPanel = page.locator('#investment_metrics_panel:not([hidden])');
    const kolCard = metricsPanel.locator('.trade-metric-card').filter({
        has: page.getByText('KOL rewards', {exact: true}),
    });
    await expect(kolCard.locator('.trade-metric-value')).toContainText('3,073.13');
    await expect(kolCard.locator('.trade-metric-value')).not.toContainText('21,511.90');

    const historyRows = page.locator('#investment_history tr[data-investment-history-row]');
    await expect(historyRows).toHaveCount(8);
    await expect.poll(() => historyRows.evaluateAll((rows) => rows.map((row) => (
        row.cells.item(5)?.textContent?.trim() || ''
    )))).toEqual(Array(8).fill('CNY'));
    await expect(historyRows.filter({hasText: 'KOL Rewards'})).toHaveCount(7);
    await expect(
        historyRows.filter({hasText: 'Manual virtual balance reset to CNY 0.00'}),
    ).toHaveCount(1);

    const currencyTrigger = page.locator(
        '#history_table_wrap [data-investment-currency-filter-trigger]',
    );
    await currencyTrigger.click();
    await expect(page.getByRole('option')).toHaveCount(2);
    await page.getByRole('option', {name: 'CNY', exact: true}).click();
    await expect(historyRows).toHaveCount(8);

    await page.locator('label[for="investment_view_holdings"]').click();
    const rewardRow = page.locator(
        '#investment_holdings_panel:not([hidden]) .investment-holdings-table-scroll tbody [data-investment-broker-rewards-row]',
    );
    await expect(rewardRow).toBeVisible();
    await expect(rewardRow.locator('td').nth(6)).toContainText('3,073.13');
    await expect(rewardRow).not.toContainText('21,511.90');
});

test('aligns Holdings Market value and clips fixed table layers at every supported width', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                date: '2026-07-17',
                type: 'buy',
                ticker: 'SGOV',
                currency: 'USD',
                quantity: 10,
                price: 100.58,
                amount: -1_005.80,
            },
        ],
        priceHistoryByTicker: {
            SGOV: [
                {date: '2026-07-16', close: 100.56},
                {date: '2026-07-17', close: 100.58},
            ],
        },
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_holdings"]').click();

    for (const viewport of [
        {width: 856, height: 769},
        {width: 1_024, height: 863},
        {width: 1_440, height: 960},
    ]) {
        await page.setViewportSize(viewport);
        await page.evaluate(() => new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        }));
        await expect.poll(() => page.evaluate(() => {
            const holdingsHeader = document.querySelector(
                '#investment_holdings_panel .investment-holdings-table[data-table-header] thead tr:first-child',
            );
            const historyHeader = document.querySelector(
                '#history_table_wrap .investment-history-table[data-table-header] thead tr',
            );
            const holdingsRow = document.querySelector(
                '#investment_holdings_panel tr[data-investment-holdings-ticker="SGOV"]',
            );
            const historyRow = document.querySelector('#investment_history tr[data-investment-history-row]');
            if (!holdingsHeader || !historyHeader || !holdingsRow || !historyRow) return null;

            const holdingsHeaderCell = holdingsHeader.cells.item(5);
            const historyHeaderCell = historyHeader.cells.item(8);
            if (!holdingsHeaderCell || !historyHeaderCell) return null;

            const holdingsHeaderRect = holdingsHeaderCell.getBoundingClientRect();
            const historyHeaderRect = historyHeaderCell.getBoundingClientRect();
            const headerCenterDelta = Math.abs(
                (holdingsHeaderRect.left + holdingsHeaderRect.right)
                - (historyHeaderRect.left + historyHeaderRect.right),
            ) / 2;
            const leftDelta = Math.abs(holdingsHeaderRect.left - historyHeaderRect.left);
            const rightDelta = Math.abs(holdingsHeaderRect.right - historyHeaderRect.right);
            return Math.max(headerCenterDelta, leftDelta, rightDelta) <= 1;
        })).toBe(true);
        const alignment = await page.evaluate(() => {
            const holdingsHeader = document.querySelector(
                '#investment_holdings_panel .investment-holdings-table[data-table-header] thead tr:first-child',
            );
            const historyHeader = document.querySelector(
                '#history_table_wrap .investment-history-table[data-table-header] thead tr',
            );
            const holdingsRow = document.querySelector(
                '#investment_holdings_panel tr[data-investment-holdings-ticker="SGOV"]',
            );
            const historyRow = document.querySelector('#investment_history tr[data-investment-history-row]');
            const holdingsHeaderRect = holdingsHeader.cells.item(5).getBoundingClientRect();
            const historyHeaderRect = historyHeader.cells.item(8).getBoundingClientRect();
            const holdingsValueCell = holdingsRow.cells.item(5);
            const historyValueCell = historyRow.cells.item(8);
            const holdingsSummaryRow = holdingsHeader.closest('table')?.tHead?.rows.item(1);
            const holdingsValueStyle = getComputedStyle(holdingsValueCell);
            const historyValueStyle = getComputedStyle(historyValueCell);
            const holdingsShell = holdingsHeader.closest('.investment-holdings-table-shell');
            const holdingsScroll = holdingsShell?.querySelector('.investment-holdings-table-scroll');
            const holdingsBodyTable = holdingsScroll?.querySelector('.investment-holdings-table');
            const holdingsBodyRows = holdingsBodyTable?.tBodies.item(0)?.rows;
            const lastBodyRow = holdingsBodyRows?.item((holdingsBodyRows.length || 1) - 1);
            const getValueRightEdge = (cell) => {
                const value = cell.querySelector(
                    '.investment-holdings-pnl-stack, .investment-holdings-allocation-badge, [data-investment-live-field]',
                );
                return value?.getBoundingClientRect().right ?? 0;
            };
            return {
                headerCenterDelta: Math.abs(
                    (holdingsHeaderRect.left + holdingsHeaderRect.right)
                    - (historyHeaderRect.left + historyHeaderRect.right),
                ) / 2,
                leftDelta: Math.abs(holdingsHeaderRect.left - historyHeaderRect.left),
                rightDelta: Math.abs(holdingsHeaderRect.right - historyHeaderRect.right),
                textAlignMatches: (
                    holdingsValueStyle.textAlign === 'right'
                    && historyValueStyle.textAlign === 'right'
                ),
                paddingMatches: (
                    holdingsValueStyle.paddingInlineStart === historyValueStyle.paddingInlineStart
                    && holdingsValueStyle.paddingInlineEnd === historyValueStyle.paddingInlineEnd
                ),
                summaryValueRightEdges: [5, 6, 7, 8].map((cellIndex) => ({
                    summary: getValueRightEdge(holdingsSummaryRow?.cells.item(cellIndex)),
                    body: getValueRightEdge(holdingsRow.cells.item(cellIndex)),
                })),
                fixedLayerGeometry: holdingsShell && holdingsScroll && lastBodyRow
                    ? (() => {
                        const shellRect = holdingsShell.getBoundingClientRect();
                        const headerRect = holdingsHeader.closest('table')?.getBoundingClientRect();
                        const scrollRect = holdingsScroll.getBoundingClientRect();
                        const cornerRadii = [
                            holdingsHeader.closest('table'),
                            holdingsHeader.cells.item(0),
                            holdingsHeader.cells.item(holdingsHeader.cells.length - 1),
                            holdingsScroll,
                            lastBodyRow.cells.item(0),
                            lastBodyRow.cells.item(lastBodyRow.cells.length - 1),
                        ].flatMap((node) => {
                            const style = getComputedStyle(node);
                            return [
                                style.borderTopLeftRadius,
                                style.borderTopRightRadius,
                                style.borderBottomRightRadius,
                                style.borderBottomLeftRadius,
                            ];
                        });
                        return {
                            shellRadii: [
                                getComputedStyle(holdingsShell).borderTopLeftRadius,
                                getComputedStyle(holdingsShell).borderTopRightRadius,
                                getComputedStyle(holdingsShell).borderBottomRightRadius,
                                getComputedStyle(holdingsShell).borderBottomLeftRadius,
                            ],
                            shellOverflow: getComputedStyle(holdingsShell).overflow,
                            scrollbarGutter: getComputedStyle(holdingsScroll).scrollbarGutter,
                            headerTop: headerRect?.top ?? 0,
                            headerBottom: headerRect?.bottom ?? 0,
                            scrollTop: scrollRect.top,
                            scrollBottom: scrollRect.bottom,
                            shellTop: shellRect.top,
                            shellBottom: shellRect.bottom,
                            cornerRadii,
                        };
                    })()
                    : null,
            };
        });
        expect(alignment.leftDelta).toBeLessThanOrEqual(1);
        expect(alignment.rightDelta).toBeLessThanOrEqual(1);
        expect(alignment.headerCenterDelta).toBeLessThanOrEqual(1);
        expect(alignment.textAlignMatches).toBe(true);
        expect(alignment.paddingMatches).toBe(true);
        alignment.summaryValueRightEdges.forEach(({summary, body}, index) => {
            expect(Math.abs(summary - body), `Holdings column ${index + 6} right edge`).toBeLessThanOrEqual(1);
        });
        expect(alignment.fixedLayerGeometry).not.toBeNull();
        expect(alignment.fixedLayerGeometry.shellRadii).toEqual(['10px', '10px', '10px', '10px']);
        expect(alignment.fixedLayerGeometry.shellOverflow).toBe('hidden');
        expect(alignment.fixedLayerGeometry.scrollbarGutter).toBe('stable');
        expect(alignment.fixedLayerGeometry.headerTop).toBeGreaterThanOrEqual(
            alignment.fixedLayerGeometry.shellTop - 1,
        );
        expect(alignment.fixedLayerGeometry.scrollTop).toBeGreaterThanOrEqual(
            alignment.fixedLayerGeometry.headerBottom - 1,
        );
        expect(alignment.fixedLayerGeometry.scrollBottom).toBeLessThanOrEqual(
            alignment.fixedLayerGeometry.shellBottom + 1,
        );
        alignment.fixedLayerGeometry.cornerRadii.forEach((radius) => {
            expect(radius).toBe('0px');
        });
    }
});

test('shows standard names for US-suffixed yfinance fallback profiles', async ({page}) => {
    const expectedNames = {
        AAPL: 'Apple Inc.',
        BOXX: 'Alpha Architect 1-3 Month Box ETF',
        EUV: 'Corgi Lithography & Semiconductor Photonics ETF',
        GOOGL: 'Alphabet Inc.',
        IBKR: 'Interactive Brokers Group, Inc.',
        JEPQ: 'JPMorgan Nasdaq Equity Premium Income ETF',
        META: 'Meta Platforms, Inc.',
        MU: 'Micron Technology, Inc.',
        NVDA: 'NVIDIA Corporation',
        QQQ: 'Invesco QQQ Trust, Series 1',
        QCOM: 'QUALCOMM Incorporated',
        TQQQ: 'ProShares UltraPro QQQ',
        TSM: 'Taiwan Semiconductor Manufacturing Company Limited',
    };
    const tickers = Object.keys(expectedNames);
    await mockInvestmentReadApis(page, {
        transactions: tickers.map((ticker, index) => ({
            ledger_no: index + 1,
            broker: 'ibkr',
            date: '2026-07-21',
            type: 'buy',
            ticker,
            currency: 'USD',
            quantity: 1,
            price: 100 + index,
            amount: -(100 + index),
        })),
        tickerProfiles: Object.fromEntries(tickers.map((ticker) => [ticker, {
            ticker,
            company_name: `${ticker}.US`,
            logo_url: `/market-store/logos/${ticker}.svg`,
        }])),
        knownTickerCompanyNames: Object.fromEntries(tickers.flatMap((ticker) => [
            [ticker, expectedNames[ticker]],
            [`${ticker}.US`, expectedNames[ticker]],
        ])),
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_holdings"]').click();

    for (const [ticker, expectedName] of Object.entries(expectedNames)) {
        const holding = page.locator(
            `#investment_holdings_panel:not([hidden]) .investment-holdings-table-scroll tr[data-investment-holdings-ticker="${ticker}"]`,
        );
        await expect(holding.locator('.ticker-identity-name')).toHaveText(expectedName);
        await expect(holding.locator('.ticker-identity-name')).toHaveAttribute('title', expectedName);
    }
});

test('resizes the investment overview and history responsively in portrait layouts', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-07-10', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 500, amount: -500},
            {broker: 'ibkr', date: '2026-07-11', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 501, amount: -501},
            {broker: 'ibkr', date: '2026-07-12', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 502, amount: -502},
            {broker: 'ibkr', date: '2026-07-13', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 503, amount: -503},
            {broker: 'ibkr', date: '2026-07-14', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 504, amount: -504},
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-07-10', close: 500},
                {date: '2026-07-11', close: 501},
                {date: '2026-07-12', close: 502},
                {date: '2026-07-13', close: 503},
                {date: '2026-07-14', close: 504},
            ],
        },
    });
    await page.setViewportSize({width: 825, height: 900});
    await page.goto('/trade/investment');
    await expect.poll(() => page.evaluate(() => (
        Boolean(window.ANTIGRAVITY_INVESTMENT_DATA)
        && document.querySelector('#workspace_modal_overlay')?.hidden === true
    )), {timeout: 30000}).toBe(true);

    const handle = page.locator('#investment_section_resizer');
    const overview = page.locator('.investment-report-card');
    const history = page.locator('#investment_history_surface');
    await expect(handle).toBeVisible();

    const resizerGeometry = await handle.evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        lineHeight: getComputedStyle(element, '::before').height,
    }));
    expect(resizerGeometry.height).toBe(12);
    expect(resizerGeometry.lineHeight).toBe('1px');

    const hiddenOpacity = await handle.evaluate((element) => getComputedStyle(element, '::after').opacity);
    expect(hiddenOpacity).toBe('0');
    await handle.hover();
    await expect.poll(() => handle.evaluate((element) => getComputedStyle(element, '::after').opacity)).toBe('1');

    const beforeHeight = await overview.evaluate((element) => element.getBoundingClientRect().height);
    const defaultAllocation = await page.evaluate(() => {
        const workspace = document.querySelector('.investment-workspace-header');
        const overviewSurface = document.querySelector('.investment-report-card');
        const historySurface = document.querySelector('#investment_history_surface');
        const overviewHeight = overviewSurface.getBoundingClientRect().height;
        const historyHeight = historySurface.getBoundingClientRect().height;
        return {
            defaultOverviewShare: getComputedStyle(workspace).getPropertyValue('--investment-default-overview-share').trim(),
            overviewShare: overviewHeight / (overviewHeight + historyHeight),
        };
    });
    expect(defaultAllocation.defaultOverviewShare).toBe('0.5');
    expect(defaultAllocation.overviewShare).toBeGreaterThanOrEqual(0.45);
    const handleBox = await handle.boundingBox();
    await page.mouse.move(handleBox.x + (handleBox.width / 2), handleBox.y + (handleBox.height / 2));
    await page.mouse.down();
    await page.mouse.move(handleBox.x + (handleBox.width / 2), handleBox.y + (handleBox.height / 2) - 40);
    await page.mouse.up();
    const draggedHeight = await overview.evaluate((element) => element.getBoundingClientRect().height);
    expect(draggedHeight).toBeLessThan(beforeHeight);

    await handle.focus();
    await handle.press('ArrowDown');
    const afterHeight = await overview.evaluate((element) => element.getBoundingClientRect().height);
    expect(afterHeight).toBeGreaterThan(draggedHeight);
    await expect(handle).toHaveAttribute('aria-valuenow', /\d+/);

    await page.setViewportSize({width: 922, height: 773});
    await handle.press('Home');
    await expect.poll(() => page.evaluate(() => {
        const stage = document.querySelector('.investment-equity-chart-stage');
        const canvas = document.querySelector('#investmentEquityChart');
        const stageMinimum = Number.parseFloat(getComputedStyle(stage).minHeight);
        return (
            canvas.getBoundingClientRect().height >= stageMinimum - 1
            && stage.getBoundingClientRect().height >= stageMinimum - 1
        );
    })).toBe(true);
    const overviewLimitGeometry = await page.evaluate(() => {
        const stage = document.querySelector('.investment-equity-chart-stage');
        const canvas = document.querySelector('#investmentEquityChart');
        return {
            canvasHeight: canvas.getBoundingClientRect().height,
            stageHeight: stage.getBoundingClientRect().height,
            stageMinimum: Number.parseFloat(getComputedStyle(stage).minHeight),
        };
    });
    expect(overviewLimitGeometry.stageHeight).toBeGreaterThanOrEqual(overviewLimitGeometry.stageMinimum - 1);
    expect(overviewLimitGeometry.canvasHeight).toBeGreaterThanOrEqual(overviewLimitGeometry.stageMinimum - 1);

    await handle.press('End');
    const historyLimitGeometry = await page.evaluate(() => {
        const shell = document.querySelector('#history_table_wrap').getBoundingClientRect();
        const header = document.querySelector('#history_table_wrap [data-table-header]').getBoundingClientRect();
        const rows = Array.from(document.querySelectorAll('#investment_history > tr:not([data-table-empty-row])'))
            .slice(0, 2)
            .map((row) => {
                const rect = row.getBoundingClientRect();
                return {top: rect.top, bottom: rect.bottom, height: rect.height};
            });
        return {shellBottom: shell.bottom, headerBottom: header.bottom, rows};
    });
    expect(historyLimitGeometry.rows).toHaveLength(2);
    expect(historyLimitGeometry.rows[0].top).toBeGreaterThanOrEqual(historyLimitGeometry.headerBottom - 1);
    expect(historyLimitGeometry.rows[1].bottom).toBeLessThanOrEqual(historyLimitGeometry.shellBottom + 1);

    await page.locator('label[for="investment_view_stock_details"]').click();
    await expect(page.locator('#investment_stock_details_table_host')).toBeVisible();
    await expect(page.locator('.investment-stock-details-price-chart-canvas')).toBeVisible();
    await page.setViewportSize({width: 922, height: 1080});
    await handle.press('End');
    const stockDetailsGeometry = await page.evaluate(() => (
        Array.from(document.querySelectorAll('#investment_history_surface .investment-history-table-shell'))
            .filter((shell) => shell instanceof HTMLElement && shell.getClientRects().length > 0)
            .map((shell) => {
                const shellRect = shell.getBoundingClientRect();
                const header = shell.querySelector('[data-table-header]')?.getBoundingClientRect();
                const rows = Array.from(shell.querySelectorAll('tbody > tr:not([data-table-empty-row])'))
                    .slice(0, 2)
                    .map((row) => row.getBoundingClientRect());
                return {
                    shellBottom: shellRect.bottom,
                    headerBottom: header?.bottom || 0,
                    rows: rows.map((row) => ({top: row.top, bottom: row.bottom})),
                };
            })
    ));
    expect(await page.locator('#history_table_wrap')).toBeHidden();
    expect(stockDetailsGeometry).toHaveLength(1);
    stockDetailsGeometry.forEach((table) => {
        expect(table.rows).toHaveLength(2);
        expect(table.rows[0].top).toBeGreaterThanOrEqual(table.headerBottom - 1);
        expect(table.rows[1].bottom).toBeLessThanOrEqual(table.shellBottom + 1);
    });

    const stockChartGeometry = await page.evaluate(() => {
        const shell = document.querySelector('.investment-stock-details-price-chart-shell');
        const canvas = document.querySelector('.investment-stock-details-price-chart-canvas');
        canvas.style.height = '80px';
        return {
            shellHeight: shell.getBoundingClientRect().height,
            canvasHeight: canvas.getBoundingClientRect().height,
            shellBottom: shell.getBoundingClientRect().bottom,
            canvasBottom: canvas.getBoundingClientRect().bottom,
        };
    });
    expect(stockChartGeometry.canvasHeight).toBeGreaterThan(80);
    expect(Math.abs(stockChartGeometry.canvasHeight - stockChartGeometry.shellHeight)).toBeLessThanOrEqual(1);
    expect(Math.abs(stockChartGeometry.canvasBottom - stockChartGeometry.shellBottom)).toBeLessThanOrEqual(1);

    await page.locator('label[for="investment_view_holdings"]').click();
    await expect(page.locator('#investment_holdings_panel')).toBeVisible();
    await handle.focus();
    await handle.press('Home');
    await expect.poll(() => page.evaluate(() => {
        const shell = document.querySelector('#investment_holdings_panel .investment-holdings-table-shell');
        const header = shell?.querySelector('[data-table-header]');
        const firstRow = shell?.querySelector(
            '.investment-holdings-table-scroll tbody > tr[data-investment-holdings-ticker]',
        );
        if (!shell || !header || !firstRow) return false;
        const shellRect = shell.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        const firstRowRect = firstRow.getBoundingClientRect();
        return (
            firstRowRect.top >= headerRect.bottom - 1
            && firstRowRect.bottom <= shellRect.bottom + 1
        );
    })).toBe(true);
    const responsiveGeometry = await page.evaluate(() => {
        const workspace = document.querySelector('.investment-workspace-header').getBoundingClientRect();
        const overviewSurface = document.querySelector('.investment-report-card').getBoundingClientRect();
        const historySurface = document.querySelector('#investment_history_surface').getBoundingClientRect();
        const historyTable = document.querySelector('#history_table_wrap').getBoundingClientRect();
        return {
            workspaceBottom: workspace.bottom,
            overviewHeight: overviewSurface.height,
            historyBottom: historySurface.bottom,
            historyHeight: historySurface.height,
            historyTableHeight: historyTable.height,
            viewportHeight: window.innerHeight,
        };
    });
    expect(responsiveGeometry.overviewHeight).toBeGreaterThanOrEqual(148);
    expect(responsiveGeometry.historyHeight).toBeGreaterThanOrEqual(148);
    expect(responsiveGeometry.historyTableHeight).toBeGreaterThan(48);
    expect(responsiveGeometry.historyBottom).toBeLessThanOrEqual(
        Math.min(responsiveGeometry.workspaceBottom, responsiveGeometry.viewportHeight) + 1,
    );
});

test('keeps investment pagination visible at the lower resize limit', async ({page}) => {
    const transactions = Array.from({length: 105}, (_, index) => {
        const price = 350 + index;
        const isSell = index % 3 === 0;
        return {
            broker: 'ibkr',
            date: '2026-07-10',
            type: isSell ? 'sell' : 'buy',
            ticker: 'GOOGL',
            currency: 'USD',
            quantity: 1,
            price,
            amount: isSell ? price : -price,
        };
    });
    await mockInvestmentReadApis(page, {
        transactions,
        priceHistoryByTicker: {
            GOOGL: [
                {date: '2026-07-06', close: 346},
                {date: '2026-07-07', close: 350},
                {date: '2026-07-08', close: 354},
                {date: '2026-07-09', close: 352},
                {date: '2026-07-10', close: 356},
            ],
        },
    });
    await page.setViewportSize({width: 1024, height: 863});
    await page.goto('/trade/investment?ticker=GOOGL#stock_panel');
    await page.locator('#sidebar_toggle').click();
    await expect(page.locator('#sidebar_toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.investment-stock-details-price-chart-canvas')).toBeVisible();
    await expect(page.locator('[data-investment-history-page-target="2"]')).toBeVisible();

    const resizer = page.locator('#investment_section_resizer');
    const resizerBox = await resizer.boundingBox();
    expect(resizerBox).not.toBeNull();
    await page.mouse.move(
        resizerBox.x + (resizerBox.width / 2),
        resizerBox.y + (resizerBox.height / 2),
    );
    await page.mouse.down();
    await page.mouse.move(
        resizerBox.x + (resizerBox.width / 2),
        page.viewportSize().height + 200,
    );
    await page.mouse.up();
    const geometry = await page.evaluate(() => {
        const surface = document.querySelector('#investment_history_surface');
        const pagination = document.querySelector('#investment_history_pagination');
        const paginationHost = document.querySelector('#investment_stock_details_table_host .investment-stock-details-table-shell');
        const paginationScroll = document.querySelector('#investment_stock_details_table_scroll');
        const historyTable = document.querySelector('#history_table_wrap');
        const resizerHandle = document.querySelector('#investment_section_resizer');
        const surfaceRect = surface.getBoundingClientRect();
        const paginationRect = pagination.getBoundingClientRect();
        const surfaceStyles = getComputedStyle(surface);
        const tables = Array.from(surface.querySelectorAll('.investment-history-table-shell'))
            .filter((shell) => shell instanceof HTMLElement && shell.getClientRects().length > 0)
            .map((shell) => {
                const shellRect = shell.getBoundingClientRect();
                const headerRect = shell.querySelector('[data-table-header]').getBoundingClientRect();
                const rows = Array.from(shell.querySelectorAll('tbody > tr:not([data-table-empty-row])'))
                    .slice(0, 2)
                    .map((row) => row.getBoundingClientRect());
                return {
                    isPaginationHost: shell === paginationHost,
                    shellTop: shellRect.top,
                    shellBottom: shellRect.bottom,
                    headerBottom: headerRect.bottom,
                    rows: rows.map((row) => ({top: row.top, bottom: row.bottom})),
                };
            });
        return {
            surfaceBottom: surfaceRect.bottom,
            contentBottom: surfaceRect.bottom - (Number.parseFloat(surfaceStyles.paddingBottom) || 0),
            paginationTop: paginationRect.top,
            paginationBottom: paginationRect.bottom,
            paginationVisible: !pagination.hidden && paginationRect.height > 0,
            paginationMounted: pagination.parentElement === paginationHost
                && pagination.dataset.paginationMounted === '1',
            historyTableHidden: historyTable.hidden,
            paginationControls: pagination.getAttribute('aria-controls'),
            paginationScrollTarget: pagination.dataset.paginationScrollTarget,
            paginationPosition: getComputedStyle(pagination).position,
            paginationBackdrop: getComputedStyle(pagination).backdropFilter,
            paginationHostOverflow: getComputedStyle(paginationHost).overflow,
            historySurfaceOverflow: getComputedStyle(surface).overflow,
            paginationScrollOverflowX: getComputedStyle(paginationScroll).overflowX,
            paginationScrollOverflowY: getComputedStyle(paginationScroll).overflowY,
            paginationIndicatorShadow: getComputedStyle(
                pagination.querySelector('.local-store-pagination-indicator'),
            ).boxShadow,
            scrollPaddingBottom: Number.parseFloat(getComputedStyle(paginationScroll).scrollPaddingBottom) || 0,
            surfacePaddingTop: Number.parseFloat(surfaceStyles.paddingTop) || 0,
            surfacePaddingBottom: Number.parseFloat(surfaceStyles.paddingBottom) || 0,
            inlineSurfacePaddingBottom: surface.style.paddingBottom,
            tableMarginBottom: Number.parseFloat(getComputedStyle(
                paginationScroll.querySelector('.investment-history-table'),
            ).marginBottom) || 0,
            resizerNow: Number(resizerHandle.getAttribute('aria-valuenow')),
            resizerMaximum: Number(resizerHandle.getAttribute('aria-valuemax')),
            tables,
        };
    });

    expect(geometry.paginationVisible).toBe(true);
    expect(geometry.paginationMounted).toBe(true);
    expect(geometry.historyTableHidden).toBe(true);
    expect(geometry.paginationControls).toBe('investment_stock_details');
    expect(geometry.paginationScrollTarget).toBe('investment_stock_details_table_scroll');
    expect(geometry.paginationPosition).toBe('absolute');
    expect(geometry.paginationBackdrop).not.toBe('none');
    expect(geometry.paginationHostOverflow).toBe('visible');
    expect(geometry.historySurfaceOverflow).toBe('visible');
    expect(geometry.paginationScrollOverflowX).toBe('auto');
    expect(geometry.paginationScrollOverflowY).toBe('auto');
    expect(geometry.paginationIndicatorShadow).not.toBe('none');
    expect(geometry.scrollPaddingBottom).toBeGreaterThan(geometry.paginationBottom - geometry.paginationTop);
    expect(geometry.surfacePaddingBottom).toBe(geometry.surfacePaddingTop);
    expect(geometry.inlineSurfacePaddingBottom).toBe('');
    expect(geometry.tableMarginBottom).toBe(0);
    expect(geometry.resizerNow).toBe(geometry.resizerMaximum);
    expect(geometry.paginationBottom).toBeLessThanOrEqual(geometry.contentBottom + 1);
    expect(geometry.paginationBottom).toBeLessThanOrEqual(geometry.surfaceBottom + 1);
    expect(geometry.tables).toHaveLength(1);
    geometry.tables.forEach((table) => {
        expect(table.rows).toHaveLength(2);
        expect(table.rows[0].top).toBeGreaterThanOrEqual(table.headerBottom - 1);
        expect(table.rows[1].bottom).toBeLessThanOrEqual(table.shellBottom + 1);
        if (table.isPaginationHost) {
            expect(geometry.paginationTop).toBeLessThan(table.shellBottom);
            expect(geometry.paginationBottom).toBeLessThanOrEqual(table.shellBottom + 1);
        } else {
            expect(table.shellBottom).toBeLessThanOrEqual(
                geometry.tables.find((candidate) => candidate.isPaginationHost).shellTop + 1,
            );
        }
    });

    const glassScrollContract = await page.evaluate(() => {
        const pagination = document.querySelector('#investment_history_pagination');
        const scroll = document.querySelector('#investment_stock_details_table_scroll');
        const rows = Array.from(scroll.querySelectorAll('#investment_stock_details > tr'));
        scroll.scrollTop = Math.max(1, (scroll.scrollHeight - scroll.clientHeight) / 2);
        const paginationRect = pagination.getBoundingClientRect();
        const rowBehindGlass = rows.some((row) => {
            const rowRect = row.getBoundingClientRect();
            return rowRect.top < paginationRect.bottom && rowRect.bottom > paginationRect.top;
        });
        scroll.scrollTop = scroll.scrollHeight;
        const table = scroll.querySelector('.investment-history-table');
        const scrollRect = scroll.getBoundingClientRect();
        const lastRowRect = rows.at(-1).getBoundingClientRect();
        const finalPaginationRect = pagination.getBoundingClientRect();
        const tailSpacerHeight = Number.parseFloat(getComputedStyle(scroll, '::after').height) || 0;
        return {
            rowBehindGlass,
            tableTailClearance: scroll.scrollHeight - table.offsetHeight,
            tailSpacerHeight,
            gapAbovePagination: finalPaginationRect.top - lastRowRect.bottom,
            gapBelowPagination: scrollRect.bottom - finalPaginationRect.bottom,
        };
    });
    expect(glassScrollContract.rowBehindGlass).toBe(true);
    expect(glassScrollContract.tailSpacerHeight).toBeGreaterThan(0);
    expect(Math.abs(
        glassScrollContract.tableTailClearance - glassScrollContract.tailSpacerHeight,
    )).toBeLessThanOrEqual(1);
    expect(glassScrollContract.gapAbovePagination).toBeGreaterThan(0);
    expect(Math.abs(
        glassScrollContract.gapAbovePagination - glassScrollContract.gapBelowPagination,
    )).toBeLessThanOrEqual(1);

    const pageTwoButton = page.locator('[data-investment-history-page-target="2"]');
    await expect(pageTwoButton).toBeVisible();
    await pageTwoButton.click();
    await expect(pageTwoButton).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => page.locator('#investment_stock_details_table_scroll').evaluate((scroll) => scroll.scrollTop)).toBe(0);

    await page.setViewportSize({width: 751, height: 762});
    await expect.poll(() => page.locator('#investment_history_surface').evaluate((surface) => {
        const styles = getComputedStyle(surface);
        return {
            bottom: Number.parseFloat(styles.paddingBottom) || 0,
            inlineBottom: surface.style.paddingBottom,
            top: Number.parseFloat(styles.paddingTop) || 0,
        };
    })).toEqual({bottom: 10, inlineBottom: '', top: 10});
});

test('omits investment pagination when transaction history fits on one page', async ({page}) => {
    const transactions = Array.from({length: 100}, (_, index) => ({
        ledger_no: index + 1,
        broker: 'ibkr',
        date: '2026-07-10',
        type: index === 0 ? 'kol_reward' : 'credit_interest',
        currency: 'USD',
        amount: 1,
        description: index === 0 ? 'KOL Rewards' : `Interest ${index + 1}`,
    }));
    await mockInvestmentReadApis(page, {transactions});
    await page.goto('/trade/investment');

    const pagination = page.locator('#investment_history_pagination');
    await expect(pagination).toBeHidden();
    await expect(pagination.locator('button')).toHaveCount(0);
    await expect(page.locator('#history_table_wrap')).not.toHaveClass(/has-floating-pagination/);
    await expect(page.getByText('KOL Reward', {exact: true}).first()).toBeVisible();
    await expect(page.getByText('KOL Rewards', {exact: true}).first()).toBeVisible();
});

test('keeps compact investment page circles concentric and labels centered', async ({page}) => {
    const transactions = Array.from({length: 401}, (_, index) => ({
        ledger_no: index + 1,
        broker: 'ibkr',
        date: '2026-07-10',
        type: 'credit_interest',
        currency: 'USD',
        amount: 1,
        description: `Interest ${index + 1}`,
    }));
    await mockInvestmentReadApis(page, {transactions});
    await page.setViewportSize({width: 620, height: 900});
    await page.goto('/trade/investment');

    const pagination = page.locator('#investment_history_pagination');
    await expect(pagination).toBeVisible();
    await expect(pagination).toHaveAttribute('data-pagination-page-count', '5');
    await expect(pagination).toHaveAttribute('data-pagination-compact', '1');
    await expect(pagination.locator('button')).toHaveCount(5);
    await expect(pagination.locator('.local-store-page-nav')).toHaveCount(0);
    await expect(pagination.locator('.local-store-page-ellipsis')).toHaveCount(0);

    const geometry = await pagination.evaluate((nav) => {
        const buttons = Array.from(nav.querySelectorAll('.local-store-page-button'));
        const navRect = nav.getBoundingClientRect();
        const firstRect = buttons[0].getBoundingClientRect();
        const lastRect = buttons.at(-1).getBoundingClientRect();
        const outerRadius = navRect.height / 2;
        const centerX = (rect) => rect.left + (rect.width / 2);
        const centerY = (rect) => rect.top + (rect.height / 2);
        const labelCenterDeltas = buttons.map((button) => {
            const textNode = button.firstChild;
            const range = document.createRange();
            range.selectNodeContents(textNode);
            const textRect = range.getBoundingClientRect();
            const buttonRect = button.getBoundingClientRect();
            return Math.abs(centerX(textRect) - centerX(buttonRect));
        });
        return {
            leftCenterDelta: Math.max(
                Math.abs(centerX(firstRect) - (navRect.left + outerRadius)),
                Math.abs(centerY(firstRect) - (navRect.top + outerRadius)),
            ),
            rightCenterDelta: Math.max(
                Math.abs(centerX(lastRect) - (navRect.right - outerRadius)),
                Math.abs(centerY(lastRect) - (navRect.top + outerRadius)),
            ),
            maximumLabelCenterDelta: Math.max(...labelCenterDeltas),
        };
    });
    expect(geometry.leftCenterDelta).toBeLessThanOrEqual(0.25);
    expect(geometry.rightCenterDelta).toBeLessThanOrEqual(0.25);
    expect(geometry.maximumLabelCenterDelta).toBeLessThanOrEqual(0.5);
});

test('keeps Local market store pagination aligned with the Investment pagination contract', async ({page}) => {
    const transactions = Array.from({length: 101}, (_, index) => ({
        ledger_no: index + 1,
        broker: 'ibkr',
        date: '2026-07-10',
        type: 'credit_interest',
        currency: 'USD',
        amount: 1,
        description: `Interest ${index + 1}`,
    }));
    await mockInvestmentReadApis(page, {transactions});
    await page.setViewportSize({width: 1_280, height: 900});

    const readPaginationContract = (pagination) => pagination.evaluate((nav) => {
        const pageControls = Array.from(nav.querySelectorAll(
            '.local-store-page-button:not(.local-store-page-nav):not(.local-store-page-placeholder)',
        ));
        const active = nav.querySelector('.local-store-page-button[aria-current="page"]');
        const inactive = pageControls.find((control) => control !== active);
        const indicator = nav.querySelector('.local-store-pagination-indicator');
        if (!(active instanceof HTMLElement)
            || !(inactive instanceof HTMLElement)
            || !(indicator instanceof HTMLElement)) {
            throw new Error('Pagination controls or active indicator are incomplete.');
        }

        const readStyle = (element, properties) => {
            const styles = getComputedStyle(element);
            return Object.fromEntries(properties.map((property) => [property, styles[property]]));
        };
        const navRect = nav.getBoundingClientRect();
        const hostRect = nav.parentElement.getBoundingClientRect();
        const activeRect = active.getBoundingClientRect();
        const inactiveRect = inactive.getBoundingClientRect();
        const indicatorRect = indicator.getBoundingClientRect();

        return {
            commonClasses: [
                'settings-pagination',
                'local-store-pagination',
                'local-store-pagination--floating',
            ].filter((className) => nav.classList.contains(className)),
            pageCount: nav.dataset.paginationPageCount || '',
            currentPage: nav.dataset.paginationCurrentPage || '',
            compact: nav.dataset.paginationCompact || '',
            semanticTargets: {
                controlledBodyExists: Boolean(document.getElementById(nav.getAttribute('aria-controls') || '')),
                scrollTargetExists: Boolean(document.getElementById(nav.dataset.paginationScrollTarget || '')),
            },
            controls: pageControls.map((control) => ({
                label: control.getAttribute('aria-label'),
                page: control.textContent.trim(),
                target: control.getAttribute('data-pagination-target'),
                current: control.getAttribute('data-pagination-current'),
                ariaCurrent: control.getAttribute('aria-current'),
            })),
            navigationControlCount: nav.querySelectorAll('.local-store-page-nav').length,
            placeholderCount: nav.querySelectorAll('.local-store-page-placeholder').length,
            ellipsisCount: nav.querySelectorAll('.local-store-page-ellipsis').length,
            presentation: {
                nav: readStyle(nav, [
                    'alignItems',
                    'backdropFilter',
                    'backgroundColor',
                    'borderRadius',
                    'boxShadow',
                    'display',
                    'gap',
                    'justifyContent',
                    'paddingBottom',
                    'paddingLeft',
                    'paddingRight',
                    'paddingTop',
                    'pointerEvents',
                    'position',
                ]),
                inactiveControl: readStyle(inactive, [
                    'alignItems',
                    'backdropFilter',
                    'backgroundColor',
                    'borderRadius',
                    'borderTopColor',
                    'borderTopStyle',
                    'borderTopWidth',
                    'boxShadow',
                    'boxSizing',
                    'color',
                    'display',
                    'fontFamily',
                    'fontSize',
                    'fontWeight',
                    'justifyContent',
                    'lineHeight',
                ]),
                indicator: readStyle(indicator, [
                    'backgroundColor',
                    'borderRadius',
                    'boxShadow',
                    'opacity',
                    'position',
                ]),
            },
            geometry: {
                activeHeight: activeRect.height,
                activeWidth: activeRect.width,
                controlGap: inactiveRect.left - activeRect.right,
                hostCenterDelta: Math.abs(
                    ((navRect.left + navRect.right) / 2)
                    - ((hostRect.left + hostRect.right) / 2),
                ),
                indicatorDelta: Math.max(
                    Math.abs(activeRect.left - indicatorRect.left),
                    Math.abs(activeRect.top - indicatorRect.top),
                    Math.abs(activeRect.width - indicatorRect.width),
                    Math.abs(activeRect.height - indicatorRect.height),
                ),
                navHeight: navRect.height,
                navWidth: navRect.width,
                outerInsetLeft: activeRect.left - navRect.left,
                outerInsetRight: navRect.right - inactiveRect.right,
            },
        };
    });
    const expectCanonicalTwoPageControls = (contract) => {
        expect(contract.commonClasses).toEqual([
            'settings-pagination',
            'local-store-pagination',
            'local-store-pagination--floating',
        ]);
        expect(contract.pageCount).toBe('2');
        expect(contract.currentPage).toBe('1');
        expect(contract.compact).toBe('1');
        expect(contract.semanticTargets).toEqual({
            controlledBodyExists: true,
            scrollTargetExists: true,
        });
        expect(contract.controls).toEqual([
            {
                label: 'Page 1',
                page: '1',
                target: '1',
                current: '1',
                ariaCurrent: 'page',
            },
            {
                label: 'Page 2',
                page: '2',
                target: '2',
                current: '0',
                ariaCurrent: null,
            },
        ]);
        expect(contract.navigationControlCount).toBe(0);
        expect(contract.placeholderCount).toBe(0);
        expect(contract.ellipsisCount).toBe(0);
        expect(contract.geometry.hostCenterDelta).toBeLessThanOrEqual(1);
        expect(contract.geometry.indicatorDelta).toBeLessThanOrEqual(1);
    };
    const expectNear = (first, second) => {
        expect(Math.abs(first - second)).toBeLessThanOrEqual(1);
    };

    await page.goto('/settings/local-market-store?page=999');
    await expect(page).toHaveURL(/\/settings\/local-market-store\?page=2$/);
    await page.goto('/settings/local-market-store');
    const settingsPagination = page.locator('[data-local-store-pagination]');
    await expect(settingsPagination).toBeVisible();
    await expect(settingsPagination).toHaveAttribute('data-pagination-page-count', '2');
    await expect(settingsPagination.locator('.local-store-pagination-indicator')).toHaveCSS('opacity', '1');
    const settingsContract = await readPaginationContract(settingsPagination);
    expectCanonicalTwoPageControls(settingsContract);

    await settingsPagination.locator('[data-pagination-target="2"]').click();
    await expect(page).toHaveURL(/\/settings\/local-market-store\?page=2$/);
    await expect(page.locator(
        '[data-local-store-pagination] [data-pagination-target="2"]',
    )).toHaveAttribute('aria-current', 'page');
    await expect(page.locator(
        '#local_store_region .local-store-table-wrap tbody .local-store-index-cell',
    )).toHaveText(['11']);

    await page.goBack();
    await expect(page).toHaveURL(/\/settings\/local-market-store$/);
    await expect(page.locator(
        '[data-local-store-pagination] [data-pagination-target="1"]',
    )).toHaveAttribute('aria-current', 'page');
    await expect(page.locator(
        '#local_store_region .local-store-table-wrap tbody .local-store-index-cell',
    )).toHaveText(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);

    await page.goForward();
    await expect(page).toHaveURL(/\/settings\/local-market-store\?page=2$/);
    await expect(page.locator(
        '[data-local-store-pagination] [data-pagination-target="2"]',
    )).toHaveAttribute('aria-current', 'page');
    await expect(page.locator(
        '#local_store_region .local-store-table-wrap tbody .local-store-index-cell',
    )).toHaveText(['11']);

    await page.mouse.move(0, 0);
    await page.goto('/trade/investment');
    const investmentPagination = page.locator('#investment_history_pagination');
    await expect(investmentPagination).toBeVisible();
    await expect(investmentPagination).toHaveAttribute('data-pagination-page-count', '2');
    await expect(investmentPagination.locator('.local-store-pagination-indicator')).toHaveCSS('opacity', '1');
    const investmentContract = await readPaginationContract(investmentPagination);
    expectCanonicalTwoPageControls(investmentContract);

    expect(settingsContract.presentation).toEqual(investmentContract.presentation);
    for (const key of [
        'activeHeight',
        'activeWidth',
        'controlGap',
        'navHeight',
        'navWidth',
        'outerInsetLeft',
        'outerInsetRight',
    ]) {
        expectNear(settingsContract.geometry[key], investmentContract.geometry[key]);
    }

    await investmentPagination.locator('[data-pagination-target="2"]').click();
    await expect(investmentPagination.locator(
        '[data-pagination-target="2"]',
    )).toHaveAttribute('aria-current', 'page');
    await expect(page.locator(
        '#investment_history > tr:not([data-table-empty-row])',
    )).toHaveCount(1);
});

test('renders fixed investment pagination chunks centered and legible in dark mode', async ({page}) => {
    const transactions = Array.from({length: 5_001}, (_, index) => ({
        ledger_no: index + 1,
        broker: 'ibkr',
        date: '2026-07-10',
        type: 'credit_interest',
        currency: 'USD',
        amount: 1,
        description: `Interest ${index + 1}`,
    }));
    await mockInvestmentReadApis(page, {transactions});
    await page.emulateMedia({colorScheme: 'dark'});
    await page.setViewportSize({width: 620, height: 900});
    await page.goto('/trade/investment');

    const pagination = page.locator('#investment_history_pagination');
    const pageFive = page.getByRole('button', {name: 'Page 5', exact: true});
    const nextPage = page.getByRole('button', {name: 'Next page', exact: true});
    await expect(pagination).toBeVisible();
    await expect(pageFive).toBeVisible();
    await expect(nextPage).toBeVisible();
    await expect(pagination.locator('[data-pagination-ellipsis="trailing"]')).toHaveCount(1);
    await expect(page.getByRole('button', {name: 'Previous page', exact: true})).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Page 51', exact: true})).toBeVisible();

    const trailingRangeTrigger = page.getByRole('button', {name: 'Show later pages', exact: true});
    const trailingRangeMenu = pagination.locator(
        '[data-pagination-ellipsis="trailing"] [data-pagination-range-menu]',
    );
    await trailingRangeTrigger.click();
    await expect(trailingRangeTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(trailingRangeMenu).toBeVisible();
    await expect(trailingRangeMenu.getByRole('menuitem')).toHaveCount(9);
    await expect(trailingRangeMenu.getByRole('menuitem', {
        name: 'Pages 6 through 10',
        exact: true,
    })).toBeVisible();
    await expect(trailingRangeMenu.getByRole('menuitem', {
        name: 'Pages 46 through 51',
        exact: true,
    })).toBeVisible();
    await trailingRangeTrigger.press('ArrowDown');
    await expect(trailingRangeMenu.getByRole('menuitem').first()).toBeFocused();
    await trailingRangeMenu.getByRole('menuitem').first().press('End');
    await expect(trailingRangeMenu.getByRole('menuitem').last()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trailingRangeTrigger).toBeFocused();
    await expect(trailingRangeTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trailingRangeMenu).toBeHidden();

    await page.setViewportSize({width: 978, height: 863});
    await setSidebarExpanded(page, true);
    await expect(page.locator('.app-shell')).toHaveClass(/is-sidebar-open/);
    const readDockCenterDelta = () => page.evaluate(() => {
        const paginationRect = document.querySelector('#investment_history_pagination').getBoundingClientRect();
        const dockRect = document.querySelector('nav[aria-label="Workspace modes"]').getBoundingClientRect();
        return Math.abs(
            ((paginationRect.top + paginationRect.bottom) / 2)
            - ((dockRect.top + dockRect.bottom) / 2),
        );
    });
    await expect.poll(readDockCenterDelta).toBeLessThanOrEqual(0.5);

    await page.setViewportSize({width: 620, height: 900});
    await setSidebarExpanded(page, false);

    const accessibilityAndGeometry = await pagination.evaluate((nav) => {
        const host = nav.parentElement;
        const navRect = nav.getBoundingClientRect();
        const hostRect = host.getBoundingClientRect();
        const active = nav.querySelector('[aria-current="page"]');
        const indicator = nav.querySelector('.local-store-pagination-indicator');
        const inactive = nav.querySelector('[aria-label="Page 5"]');
        const ellipsis = nav.querySelector('[data-pagination-ellipsis="trailing"]');
        const ellipsisTrigger = ellipsis.querySelector('[data-pagination-range-trigger]');
        const ellipsisDots = ellipsis.querySelector('.local-store-page-ellipsis-dots');
        const buttonRects = Array.from(nav.querySelectorAll('.local-store-page-button')).map((button) => {
            const rect = button.getBoundingClientRect();
            return {left: rect.left, right: rect.right};
        });
        const parseColor = (value) => {
            const channels = String(value).match(/[\d.]+/g)?.slice(0, 3).map(Number) || [];
            return channels.length === 3 ? channels : null;
        };
        const resolveColor = (value) => {
            const probe = document.createElement('span');
            probe.style.color = value;
            document.body.append(probe);
            const resolved = getComputedStyle(probe).color;
            probe.remove();
            return resolved;
        };
        const luminance = (channels) => {
            const linear = channels.map((channel) => {
                const normalized = channel / 255;
                return normalized <= 0.04045
                    ? normalized / 12.92
                    : ((normalized + 0.055) / 1.055) ** 2.4;
            });
            return (linear[0] * 0.2126) + (linear[1] * 0.7152) + (linear[2] * 0.0722);
        };
        const contrast = (foreground, background) => {
            const foregroundLuminance = luminance(parseColor(foreground));
            const backgroundLuminance = luminance(parseColor(background));
            const lighter = Math.max(foregroundLuminance, backgroundLuminance);
            const darker = Math.min(foregroundLuminance, backgroundLuminance);
            return (lighter + 0.05) / (darker + 0.05);
        };
        const rootStyles = getComputedStyle(document.documentElement);
        const themeText = resolveColor(rootStyles.getPropertyValue('--theme-text'));
        const themeBackground = resolveColor(rootStyles.getPropertyValue('--theme-background'));
        const activeRect = active.getBoundingClientRect();
        const indicatorRect = indicator.getBoundingClientRect();
        const ellipsisRect = ellipsis.getBoundingClientRect();
        const ellipsisDotsRect = ellipsisDots.getBoundingClientRect();
        return {
            centerDelta: Math.abs(
                ((navRect.left + navRect.right) / 2) - ((hostRect.left + hostRect.right) / 2),
            ),
            navInsideHost: navRect.left >= hostRect.left - 1 && navRect.right <= hostRect.right + 1,
            allButtonsInsideNav: buttonRects.every((rect) => (
                rect.left >= navRect.left - 1 && rect.right <= navRect.right + 1
            )),
            everyButtonHasStateAndLabel: Array.from(nav.querySelectorAll('.local-store-page-button')).every((button) => (
                button.hasAttribute('data-investment-history-page-target')
                && button.hasAttribute('data-pagination-current')
                && button.hasAttribute('aria-label')
            )),
            currentButtonCount: nav.querySelectorAll('[data-pagination-current="1"][aria-current="page"]').length,
            inactiveUsesThemeText: getComputedStyle(inactive).color === themeText,
            inactiveContrast: contrast(themeText, themeBackground),
            activeContrast: contrast(
                getComputedStyle(active).color,
                getComputedStyle(indicator).backgroundColor,
            ),
            indicatorDelta: Math.max(
                Math.abs(activeRect.left - indicatorRect.left),
                Math.abs(activeRect.top - indicatorRect.top),
                Math.abs(activeRect.width - indicatorRect.width),
                Math.abs(activeRect.height - indicatorRect.height),
            ),
            ellipsisHasNoFontGlyph: ellipsisTrigger.textContent === '',
            ellipsisDotSize: {
                width: ellipsisDotsRect.width,
                height: ellipsisDotsRect.height,
            },
            ellipsisCenterDelta: Math.max(
                Math.abs(
                    ((ellipsisRect.left + ellipsisRect.right) / 2)
                    - ((ellipsisDotsRect.left + ellipsisDotsRect.right) / 2),
                ),
                Math.abs(
                    ((ellipsisRect.top + ellipsisRect.bottom) / 2)
                    - ((ellipsisDotsRect.top + ellipsisDotsRect.bottom) / 2),
                ),
            ),
            ellipsisHasTwoOuterDots: getComputedStyle(ellipsisDots).boxShadow.split('rgb').length === 3,
        };
    });
    expect(accessibilityAndGeometry.centerDelta).toBeLessThanOrEqual(1);
    expect(accessibilityAndGeometry.navInsideHost).toBe(true);
    expect(accessibilityAndGeometry.allButtonsInsideNav).toBe(true);
    expect(accessibilityAndGeometry.everyButtonHasStateAndLabel).toBe(true);
    expect(accessibilityAndGeometry.currentButtonCount).toBe(1);
    expect(accessibilityAndGeometry.inactiveUsesThemeText).toBe(true);
    expect(accessibilityAndGeometry.inactiveContrast).toBeGreaterThanOrEqual(4.5);
    expect(accessibilityAndGeometry.activeContrast).toBeGreaterThanOrEqual(4.5);
    expect(accessibilityAndGeometry.indicatorDelta).toBeLessThanOrEqual(1);
    expect(accessibilityAndGeometry.ellipsisHasNoFontGlyph).toBe(true);
    expect(accessibilityAndGeometry.ellipsisDotSize).toEqual({width: 3, height: 3});
    expect(accessibilityAndGeometry.ellipsisCenterDelta).toBeLessThanOrEqual(0.5);
    expect(accessibilityAndGeometry.ellipsisHasTwoOuterDots).toBe(true);

    await page.getByRole('button', {name: 'Page 4', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Page 4', exact: true})).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', {name: 'Next page', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Page 6', exact: true})).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', {name: 'Next page', exact: true})).toHaveAttribute(
        'data-investment-history-page-target',
        '11',
    );
    const previousPage = page.getByRole('button', {name: 'Previous page', exact: true});
    await expect(previousPage).toHaveAttribute('data-investment-history-page-target', '5');
    await expect(pagination.locator('[data-pagination-ellipsis="leading"]')).toHaveCount(1);
    await expect(pagination.locator('[data-pagination-ellipsis="trailing"]')).toHaveCount(1);
    await expect(page.getByRole('button', {name: 'Page 1', exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Page 7', exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Page 51', exact: true})).toBeVisible();
    const readMiddleChunkGeometry = () => pagination.evaluate((nav) => {
        const hostRect = nav.parentElement.getBoundingClientRect();
        const navRect = nav.getBoundingClientRect();
        const activeRect = nav.querySelector('[aria-current="page"]').getBoundingClientRect();
        const indicatorRect = nav.querySelector('.local-store-pagination-indicator').getBoundingClientRect();
        return {
            centerDelta: Math.abs(
                ((navRect.left + navRect.right) / 2) - ((hostRect.left + hostRect.right) / 2),
            ),
            containmentOverflow: Math.max(0, hostRect.left - navRect.left, navRect.right - hostRect.right),
            indicatorDelta: Math.max(
                Math.abs(activeRect.left - indicatorRect.left),
                Math.abs(activeRect.top - indicatorRect.top),
                Math.abs(activeRect.width - indicatorRect.width),
                Math.abs(activeRect.height - indicatorRect.height),
            ),
        };
    });
    await expect.poll(async () => (await readMiddleChunkGeometry()).centerDelta).toBeLessThanOrEqual(1);
    await expect.poll(async () => (await readMiddleChunkGeometry()).containmentOverflow).toBeLessThanOrEqual(1);
    await expect.poll(async () => (await readMiddleChunkGeometry()).indicatorDelta).toBeLessThanOrEqual(1);

    await previousPage.click();
    await expect(page.getByRole('button', {name: 'Page 5', exact: true})).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', {name: 'Previous page', exact: true})).toHaveCount(0);
    await page.getByRole('button', {name: 'Next page', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Page 6', exact: true})).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', {name: 'Next page', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Page 11', exact: true})).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', {name: 'Previous page', exact: true})).toHaveAttribute(
        'data-investment-history-page-target',
        '10',
    );
    await expect(page.getByRole('button', {name: 'Next page', exact: true})).toHaveAttribute(
        'data-investment-history-page-target',
        '16',
    );
});

test('uses the Neo stock-details composition without chart or donut collisions', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-07-10', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 500, amount: -500},
            {broker: 'hsbc', date: '2026-07-11', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 501, amount: -501},
            {broker: 'ibkr', date: '2026-07-12', type: 'sell', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 502, amount: 502},
            {broker: 'hsbc', date: '2026-07-13', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 503, amount: -503},
            {broker: 'ibkr', date: '2026-07-14', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 504, amount: -504},
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-07-10', close: 500},
                {date: '2026-07-11', close: 501},
                {date: '2026-07-12', close: 502},
                {date: '2026-07-13', close: 503},
                {date: '2026-07-14', close: 504},
            ],
        },
        tickerProfiles: {
            QQQ: {
                ticker: 'QQQ',
                company_name: 'Invesco QQQ Trust',
                logo_url: '/market-store/logos/QQQ.svg',
            },
        },
    });
    await page.setViewportSize({width: 1024, height: 863});
    await page.goto('/trade/investment?ticker=QQQ#stock_panel');
    await expect.poll(() => page.evaluate(() => window.ANTIGRAVITY_INVESTMENT_MODULE_VERSIONS)).toEqual({
        entry: 'v2.128.3',
        chartOrbit: 'v1.38.0',
        dataUtils: 'v1.108.0',
        importFeedback: 'v1.8.5',
        layout: 'v1.1.0',
        pagination: 'v1.4.0',
        realtime: 'v1.3.1',
        numericDisplay: 'v1.0.0',
        stockDetails: 'v0.25.0',
        transactionFilters: 'v1.3.0',
        transactionTable: 'v1.0.1',
        urlState: 'v1.2.0',
    });
    await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource').some((entry) => {
        const url = new URL(entry.name);
        return url.pathname.endsWith('/assets/js/investment/stock-details.js')
            && url.searchParams.get('v') === 'investment-stock-details-v0.25.0';
    }))).toBe(true);
    await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource').some((entry) => {
        const url = new URL(entry.name);
        return url.pathname.endsWith('/assets/js/investment/import-feedback.js')
            && url.searchParams.get('v') === 'investment-import-feedback-v1.8.5';
    }))).toBe(true);
    await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource').some((entry) => {
        const url = new URL(entry.name);
        return url.pathname.endsWith('/assets/js/chart.js')
            && url.searchParams.get('v')?.endsWith('-chart-v0.9.7');
    }))).toBe(true);
    await page.locator('#sidebar_toggle').click();
    await expect(page.locator('#sidebar_toggle')).toHaveAttribute('aria-expanded', 'false');
    const priceChartCanvas = page.locator('#stock_panel .investment-stock-details-price-chart-canvas');
    await expect(priceChartCanvas).toBeVisible();
    const priceChartBox = await priceChartCanvas.boundingBox();
    if (!priceChartBox) throw new Error('Stock-details price chart has no visible box.');
    await page.mouse.move(
        priceChartBox.x + (priceChartBox.width * 0.55),
        priceChartBox.y + (priceChartBox.height * 0.52),
    );
    await expect.poll(() => page.evaluate(() => {
        const canvas = document.querySelector('#stock_panel .investment-stock-details-price-chart-canvas');
        const chart = canvas && window.Chart?.getChart?.(canvas);
        return Boolean(chart?._activeInvestmentStockDetailsGuideBounds?.formattedPrice);
    })).toBe(true);
    const hoverBadgePixels = await page.evaluate(() => {
        const canvas = document.querySelector('#stock_panel .investment-stock-details-price-chart-canvas');
        const chart = canvas && window.Chart?.getChart?.(canvas);
        const bounds = chart?._activeInvestmentStockDetailsGuideBounds;
        const context = canvas?.getContext('2d');
        if (!canvas || !bounds || !context) return null;
        const scaleX = canvas.width / canvas.getBoundingClientRect().width;
        const scaleY = canvas.height / canvas.getBoundingClientRect().height;
        const readPixel = (x, y) => Array.from(context.getImageData(
            Math.round(x * scaleX),
            Math.round(y * scaleY),
            1,
            1,
        ).data);
        return {
            allocationBadgeRadius: getComputedStyle(canvas)
                .getPropertyValue('--investment-holdings-allocation-badge-radius').trim(),
            corner: readPixel(bounds.badgeLeft + 0.5, bounds.badgeTop + 0.5),
            center: readPixel(
                (bounds.badgeLeft + bounds.badgeRight) / 2,
                (bounds.badgeTop + bounds.badgeBottom) / 2,
            ),
        };
    });
    expect(hoverBadgePixels).not.toBeNull();
    expect(hoverBadgePixels.allocationBadgeRadius).toBe('2px');
    expect(hoverBadgePixels.corner).not.toEqual(hoverBadgePixels.center);

    const readGeometry = () => page.evaluate(() => {
        const select = (selector) => document.querySelector(`#stock_panel ${selector}`);
        const identity = select('.investment-stock-details-identity');
        const metrics = select('.investment-stock-details-metrics');
        const chartCard = select('.investment-stock-details-price-chart-card');
        const range = select('.investment-stock-details-range-shell');
        const chartShell = select('.investment-stock-details-price-chart-shell');
        const canvas = select('.investment-stock-details-price-chart-canvas');
        const donutCard = select('.investment-stock-details-donut-card');
        const donutShell = select('.investment-stock-details-donut-shell');
        const donut = select('.investment-stock-details-donut');
        const logo = select('.investment-stock-details-donut-logo');
        if (!identity || !metrics || !chartCard || !range || !chartShell || !canvas
            || !donutCard || !donutShell || !donut || !logo) return null;
        const identityRect = identity.getBoundingClientRect();
        const metricsRect = metrics.getBoundingClientRect();
        const chartCardRect = chartCard.getBoundingClientRect();
        const rangeRect = range.getBoundingClientRect();
        const chartRect = chartShell.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        const donutCardRect = donutCard.getBoundingClientRect();
        const donutShellRect = donutShell.getBoundingClientRect();
        const donutRect = donut.getBoundingClientRect();
        const logoRect = logo.getBoundingClientRect();
        return {
            identityTop: identityRect.top,
            rangeTop: rangeRect.top,
            rangeBottom: rangeRect.bottom,
            chartTop: chartRect.top,
            chartBottom: chartRect.bottom,
            canvasBottom: canvasRect.bottom,
            chartCardTop: chartCardRect.top,
            chartCardBottom: chartCardRect.bottom,
            metricsBottom: metricsRect.bottom,
            metricsOverflow: metrics.scrollHeight - metrics.clientHeight,
            metricsOverflowY: getComputedStyle(metrics).overflowY,
            chartCenterY: chartRect.top + (chartRect.height / 2),
            donutCenterY: donutRect.top + (donutRect.height / 2),
            donutDiameter: donutRect.width,
            donutFrameWidth: donutShellRect.width,
            donutCardBottom: donutCardRect.bottom,
            logoContained: (
                logoRect.left >= donutShellRect.left - 1
                && logoRect.right <= donutShellRect.right + 1
                && logoRect.top >= donutShellRect.top - 1
                && logoRect.bottom <= donutShellRect.bottom + 1
            ),
        };
    });

    await expect.poll(async () => {
        const currentGeometry = await readGeometry();
        if (!currentGeometry) return Number.POSITIVE_INFINITY;
        return Math.abs(currentGeometry.chartCenterY - currentGeometry.donutCenterY);
    }).toBeLessThanOrEqual(2);
    const geometry = await readGeometry();

    expect(geometry).not.toBeNull();
    expect(Math.abs(geometry.identityTop - geometry.rangeTop)).toBeLessThanOrEqual(1);
    expect(geometry.rangeBottom).toBeLessThanOrEqual(geometry.chartTop);
    expect(Math.abs(geometry.chartBottom - geometry.canvasBottom)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.chartCardTop - geometry.identityTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.chartCardBottom - geometry.metricsBottom)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.chartCardBottom - geometry.donutCardBottom)).toBeLessThanOrEqual(1);
    expect(geometry.metricsOverflowY).toBe('auto');
    expect(geometry.metricsOverflow).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.chartCenterY - geometry.donutCenterY)).toBeLessThanOrEqual(2);
    expect(geometry.donutDiameter).toBeGreaterThan(120);
    expect(geometry.donutFrameWidth - geometry.donutDiameter).toBeLessThanOrEqual(50);
    expect(geometry.logoContained).toBe(true);

    await page.setViewportSize({width: 430, height: 900});
    await expect.poll(() => page.evaluate(() => {
        const shell = document.querySelector('#stock_panel .investment-stock-details-donut-shell')
            ?.getBoundingClientRect();
        const logo = document.querySelector('#stock_panel .investment-stock-details-donut-logo')
            ?.getBoundingClientRect();
        return Boolean(shell && logo
            && logo.left >= shell.left - 1
            && logo.right <= shell.right + 1
            && logo.top >= shell.top - 1
            && logo.bottom <= shell.bottom + 1);
    })).toBe(true);
    const mobileDonutGeometry = await page.evaluate(() => {
        const shell = document.querySelector('#stock_panel .investment-stock-details-donut-shell')
            .getBoundingClientRect();
        const donut = document.querySelector('#stock_panel .investment-stock-details-donut')
            .getBoundingClientRect();
        return {
            frameWidth: shell.width,
            frameHeight: shell.height,
            donutDiameter: donut.width,
        };
    });
    expect(Math.abs(mobileDonutGeometry.frameWidth - mobileDonutGeometry.frameHeight)).toBeLessThanOrEqual(1);
    expect(mobileDonutGeometry.frameWidth - mobileDonutGeometry.donutDiameter).toBeLessThanOrEqual(50);
});

test('keeps QQQI Stock details cost labels out of metrics and tooltip', async ({page}) => {
    const ticker = 'QQQI';
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-07-10', type: 'buy', ticker, currency: 'USD', quantity: 2, price: 50, amount: -100},
            {broker: 'ibkr', date: '2026-07-11', type: 'buy', ticker, currency: 'USD', quantity: 1, price: 52, amount: -52},
            {broker: 'ibkr', date: '2026-07-12', type: 'sell', ticker, currency: 'USD', quantity: 1, price: 55, amount: 55},
        ],
        priceHistoryByTicker: {
            [ticker]: [
                {date: '2026-07-10', close: 50},
                {date: '2026-07-11', close: 52},
                {date: '2026-07-12', close: 55},
            ],
        },
        tickerProfiles: {
            [ticker]: {
                ticker,
                company_name: 'NEOS Nasdaq-100 High Income ETF',
                logo_url: '/market-store/logos/QQQI.svg',
            },
        },
    });
    await page.setViewportSize({width: 1024, height: 863});
    await page.goto('/trade/investment?view=stock-details&ticker=QQQI&range=auto');

    const stockPanel = page.locator('#stock_panel');
    await expect(stockPanel).toBeVisible();
    await expect(stockPanel.locator('.trade-metric-label').filter({hasText: /^Average price$/})).toHaveCount(1);
    for (const forbiddenLabel of [
        'Lowest-cost lots first',
        'FIFO',
        'LIFO',
        'Moving average cost',
        'FIFO reconstructed',
    ]) {
        await expect(stockPanel).not.toContainText(forbiddenLabel);
    }

    await expect.poll(() => page.evaluate(() => {
        const canvas = document.querySelector('#stock_panel .investment-stock-details-price-chart-canvas');
        const chart = canvas && window.Chart?.getChart?.(canvas);
        const dataset = chart?.data?.datasets?.[0]?.data || [];
        const index = dataset.findIndex((value) => Number.isFinite(value));
        const point = index >= 0 ? chart?.getDatasetMeta(0)?.data?.[index] : null;
        if (!chart || !point) return false;
        const center = point.getCenterPoint();
        const activeElements = [{datasetIndex: 0, index}];
        chart.setActiveElements(activeElements);
        chart.tooltip?.setActiveElements(activeElements, {x: center.x, y: center.y});
        chart.update('none');
        return true;
    })).toBe(true);

    const tooltip = page.locator('[data-investment-stock-details-tooltip="1"]');
    await expect(tooltip).toHaveClass(/is-visible/);
    await expect(tooltip.locator('.chart-tooltip-label').filter({hasText: /^Average price$/})).toHaveCount(1);
    for (const forbiddenLabel of [
        'Lowest-cost lots first',
        'FIFO',
        'LIFO',
        'Moving average cost',
        'FIFO reconstructed',
    ]) {
        await expect(tooltip).not.toContainText(forbiddenLabel);
    }
    const chartDatasetLabels = await page.evaluate(() => {
        const canvas = document.querySelector('#stock_panel .investment-stock-details-price-chart-canvas');
        return window.Chart?.getChart?.(canvas)?.data?.datasets?.map((dataset) => dataset.label) || [];
    });
    expect(chartDatasetLabels).toContain('QQQI Average price');
});

test('shows date-scoped realized and unrealized P&L in the Stock details tooltip', async ({page}) => {
    const ticker = 'DRAM';
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-08-01', type: 'buy', ticker, currency: 'USD', quantity: 10, price: 100, amount: -1_000},
            {broker: 'ibkr', date: '2026-08-02', type: 'sell', ticker, currency: 'USD', quantity: 4, price: 120, amount: 480},
        ],
        priceHistoryByTicker: {
            [ticker]: [
                {date: '2026-08-01', close: 110},
                {date: '2026-08-02', close: 120},
            ],
        },
        tickerProfiles: {
            [ticker]: {
                ticker,
                company_name: 'Roundhill Memory ETF',
                logo_url: '/market-store/logos/DRAM.svg',
            },
        },
    });
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto(`/trade/investment?view=stock-details&ticker=${ticker}&range=auto`);

    const tooltip = page.locator('[data-investment-stock-details-tooltip="1"]');
    await expect.poll(() => page.evaluate(() => {
        const canvas = document.querySelector('#stock_panel .investment-stock-details-price-chart-canvas');
        const chart = canvas && window.Chart?.getChart?.(canvas);
        const values = chart?.data?.datasets?.[0]?.data || [];
        const indexes = values
            .map((value, index) => Number.isFinite(value) ? index : -1)
            .filter((index) => index >= 0);
        const index = indexes[indexes.length - 1] ?? -1;
        const point = index >= 0 ? chart?.getDatasetMeta(0)?.data?.[index] : null;
        if (!chart || !point) return false;
        const center = point.getCenterPoint();
        const activeElements = [{datasetIndex: 0, index}];
        chart.setActiveElements(activeElements);
        chart.tooltip?.setActiveElements(activeElements, {x: center.x, y: center.y});
        chart.update('none');
        return true;
    })).toBe(true);
    await expect(tooltip).toHaveClass(/is-visible/);
    await expect(tooltip.locator('.chart-tooltip-label').filter({hasText: /^Unrealized P&L$/})).toHaveCount(1);
    await expect(tooltip.locator('.chart-tooltip-label').filter({hasText: /^Realized P&L$/})).toHaveCount(1);

    const pnlValues = await tooltip.locator('.chart-tooltip-row').evaluateAll((rows) => Object.fromEntries(
        rows
            .map((row) => [
                row.querySelector('.chart-tooltip-label')?.textContent || '',
                row.querySelector('.chart-tooltip-value')?.textContent || '',
            ])
            .filter(([label]) => ['Unrealized P&L', 'Realized P&L'].includes(label)),
    ));
    expect(pnlValues).toEqual({
        'Unrealized P&L': '120.00',
        'Realized P&L': '80.00',
    });
});

test('uses the standard green token logo for money-market Stock details identity', async ({page}) => {
    const ticker = '005276756';
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-07-14', type: 'buy', ticker, currency: 'USD', quantity: 1, price: 1, amount: -1},
        ],
        priceHistoryByTicker: {
            [ticker]: [{date: '2026-07-14', close: 1}],
        },
        tickerProfiles: {
            [ticker]: {
                ticker,
                company_name: 'Franklin Templeton U.S. Dollar Short-Term Money Market Fund',
                logo_url: '/market-store/logos/dollarsign.ring.svg',
            },
        },
        moneyMarketTickers: [ticker],
    });
    await page.goto(`/trade/investment?ticker=${ticker}#stock_panel`);
    await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource').some((entry) => {
        const url = new URL(entry.name);
        return url.pathname.endsWith('/assets/css/views/investment.css')
            && url.searchParams.get('v') === '1.75.43';
    }))).toBe(true);

    const tokenLogo = page.locator('#stock_panel .investment-stock-details-identity .investment-cash-equivalent-token-logo');
    await expect(tokenLogo).toHaveCount(1);
    await expect(tokenLogo).toBeVisible();
    await expect(page.locator('#stock_panel .investment-stock-details-identity .ticker-identity-symbol')).toHaveText(ticker);
    await expect(page.locator('#stock_panel .investment-stock-details-identity .ticker-identity-name'))
        .toHaveText('Franklin Templeton U.S. Dollar Short-Term Money Market Fund');
    await expect(page.locator('#stock_panel .investment-stock-details-identity img.ticker-identity-logo')).toHaveCount(0);
    await expect.poll(() => tokenLogo.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            backgroundColor: style.backgroundColor,
            maskImage: style.maskImage || style.webkitMaskImage,
        };
    })).toMatchObject({
        backgroundColor: expect.stringMatching(/rgb\(/),
        maskImage: expect.stringContaining('dollarsign.ring.svg'),
    });
});

test('uses the standard green token logo for money-market Holdings and portfolio donut identities', async ({page}) => {
    const ticker = '005276756';
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-07-14', type: 'buy', ticker, currency: 'USD', quantity: 1, price: 1, amount: -1},
        ],
        priceHistoryByTicker: {
            [ticker]: [{date: '2026-07-14', close: 1}],
        },
        tickerProfiles: {
            [ticker]: {
                ticker,
                company_name: 'Franklin Templeton U.S. Dollar Short-Term Money Market Fund',
                logo_url: '/market-store/logos/dollarsign.ring.svg',
            },
        },
        moneyMarketTickers: [ticker],
    });
    await page.goto('/trade/investment?view=overview');
    const holdingsRow = '#investment_holdings_panel tr[data-investment-holdings-ticker]';
    await expect.poll(() => page.locator(holdingsRow).count(), {timeout: 30_000}).toBeGreaterThan(0);

    const readTokenStyle = (selector) => (typeof selector === 'string' ? page.locator(selector) : selector).evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            tagName: element.tagName,
            backgroundColor: style.backgroundColor,
            maskImage: style.maskImage || style.webkitMaskImage,
        };
    });
    const donutLogo = '#investment_dummy_logo_layer .portfolio-donut-logo.investment-cash-equivalent-token-logo';
    await expect(page.locator(donutLogo)).toHaveCount(1);
    await page.locator('html').evaluate((root) => root.setAttribute('data-theme-override', 'light'));
    await expect.poll(() => readTokenStyle(donutLogo)).toEqual({
        tagName: 'SPAN',
        backgroundColor: 'rgb(22, 163, 74)',
        maskImage: expect.stringContaining('dollarsign.ring.svg'),
    });
    await page.locator('html').evaluate((root) => root.setAttribute('data-theme-override', 'dark'));
    await expect.poll(() => readTokenStyle(donutLogo)).toEqual({
        tagName: 'SPAN',
        backgroundColor: 'rgb(47, 255, 156)',
        maskImage: expect.stringContaining('dollarsign.ring.svg'),
    });

    await page.locator('label[for="investment_view_holdings"]').click();
    const holdingsLogo = page.locator(`${holdingsRow} .investment-holdings-ticker-link .investment-cash-equivalent-token-logo`).first();
    await expect(holdingsLogo).toHaveCount(1);
    await expect.poll(() => readTokenStyle(holdingsLogo)).toMatchObject({
        tagName: 'SPAN',
        backgroundColor: 'rgb(47, 255, 156)',
        maskImage: expect.stringContaining('dollarsign.ring.svg'),
    });
});

test('uses placeholders without probing nonexistent investment logo files', async ({page}) => {
    const ticker = '584752.HK';
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                date: '2026-07-14',
                type: 'buy',
                ticker,
                currency: 'HKD',
                quantity: 1,
                price: 100,
                amount: -100,
                normalized: {
                    display_quantity: 1,
                    unit_price: 100,
                    net_amount: -100,
                },
            },
        ],
        priceHistoryByTicker: {
            [ticker]: [{date: '2026-07-14', close: 100}],
        },
        tickerProfiles: {
            [ticker]: {
                ticker,
                company_name: 'Unlisted test security',
                logo_url: '',
            },
        },
    });
    await page.goto(`/trade/investment?ticker=${encodeURIComponent(ticker)}`);

    await page.locator('label[for="investment_view_stock_details"]').click();
    await expect(page.locator('#stock_panel')).toBeVisible();
    await expect(page.locator('#stock_panel .ticker-identity-logo-placeholder')).toBeVisible();
    await expect(page.locator('#stock_panel .investment-stock-details-donut-logo')).toHaveCount(0);
    await expect(page.locator('img[loading="lazy"]')).toHaveCount(0);

    const speculativeLogoRequests = await page.evaluate((missingTicker) => (
        performance.getEntriesByType('resource')
            .map((entry) => new URL(entry.name).pathname)
            .filter((pathname) => (
                pathname.startsWith('/market-store/logos/')
                && pathname.includes(missingTicker)
            ))
    ), ticker);
    expect(speculativeLogoRequests).toEqual([]);
});

test('redraws the Overview live endpoint and breathing marker when the first regular-session quote arrives', async ({page}) => {
    await page.addInitScript(() => {
        const RealDate = Date;
        const fixedTimestamp = new RealDate('2026-07-22T14:00:00Z').valueOf();
        class FixedDate extends RealDate {
            constructor(...args) {
                super(...(args.length ? args : [fixedTimestamp]));
            }

            static now() {
                return fixedTimestamp;
            }
        }
        window.Date = FixedDate;

        const nativeSetTimeout = window.setTimeout.bind(window);
        window.setTimeout = (callback, delay, ...args) => {
            if (delay === 60_000 && typeof callback === 'function') {
                window.__testTriggerInvestmentOverviewRealtimePoll = () => callback(...args);
                return 0;
            }
            return nativeSetTimeout(callback, delay, ...args);
        };
    });
    let quotePrice = null;
    const liveQuotes = () => (Number.isFinite(quotePrice) ? [{
        ticker: 'DRAM',
        price: quotePrice,
        timestamp: '2026-07-22 10:00',
        session: 'intraday',
        session_date: '2026-07-22',
        market: 'US',
        source: 'yfinance',
    }] : []);
    await mockInvestmentReadApis(page, {
        transactions: [
            {ledger_no: 1, broker: 'ibkr', date: '2026-07-21', type: 'buy', ticker: 'DRAM', currency: 'USD', quantity: 10, price: 100, amount: -1000},
        ],
        priceHistoryByTicker: {
            DRAM: [
                {date: '2026-07-20', close: 99},
                {date: '2026-07-21', close: 100},
            ],
        },
        realtimeQuotes: liveQuotes,
        marketSession: {
            session: 'intraday',
            is_trading_day: true,
            is_realtime_allowed: true,
            session_date: '2026-07-22',
        },
    });
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment');
    await expect.poll(() => page.evaluate(() => (
        typeof window.__testTriggerInvestmentOverviewRealtimePoll
    ))).toBe('function');

    const marker = page.locator('[data-investment-equity-live-marker]');
    await expect.poll(() => marker.evaluate((element) => element.hidden)).toBe(true);
    const baselineEquity = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const values = chart?.data?.datasets?.[0]?.data || [];
        return Number(values[values.length - 1]);
    });

    quotePrice = 120;
    await page.evaluate(() => window.__testTriggerInvestmentOverviewRealtimePoll());
    await expect.poll(() => marker.evaluate((element) => !element.hidden)).toBe(true);
    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const values = chart?.data?.datasets?.[0]?.data || [];
        return Number(values[values.length - 1]);
    })).not.toBe(baselineEquity);

    const markerState = await marker.evaluate((element) => {
        const canvas = document.querySelector('#investmentEquityChart');
        const chart = window.Chart?.getChart(canvas);
        const lastIndex = chart.data.labels.length - 1;
        const lastValue = Number(chart.data.datasets[0].data[lastIndex]);
        return {
            animation: getComputedStyle(element.querySelector('.investment-equity-live-marker-ring-outer')).animationName,
            left: Number.parseFloat(element.style.left),
            top: Number.parseFloat(element.style.top),
            expectedLeft: chart.scales.x.getPixelForValue(lastIndex),
            expectedTop: chart.scales.y.getPixelForValue(lastValue),
        };
    });
    expect(markerState.animation).toBe('investment-live-marker-breath-outer');
    expect(Math.abs(markerState.left - markerState.expectedLeft)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(markerState.top - markerState.expectedTop)).toBeLessThanOrEqual(0.5);
});

test('marks Investment Holdings with Longbridge overnight quotes', async ({page}) => {
    await page.addInitScript(() => {
        const RealDate = Date;
        const fixedTimestamp = new RealDate('2026-07-28T03:30:00Z').valueOf();
        class FixedDate extends RealDate {
            constructor(...args) {
                super(...(args.length ? args : [fixedTimestamp]));
            }

            static now() {
                return fixedTimestamp;
            }
        }
        window.Date = FixedDate;
    });
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                date: '2026-07-27',
                type: 'buy',
                ticker: 'DRAM',
                currency: 'USD',
                quantity: 10,
                price: 52.43,
                amount: -524.30,
            },
        ],
        priceHistoryByTicker: {
            DRAM: [
                {date: '2026-07-24', close: 53.20},
                {date: '2026-07-27', close: 52.43},
            ],
        },
        realtimeQuotes: [{
            ticker: 'DRAM',
            price: 49.40,
            timestamp: '2026-07-27 23:30',
            session: 'overnight',
            session_date: '2026-07-28',
            market: 'US',
            source: 'longbridge',
        }],
        marketSession: {
            session: 'overnight',
            is_trading_day: true,
            is_realtime_allowed: true,
            session_date: '2026-07-28',
        },
    });
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_holdings"]').click();

    const holdingRow = page.locator(
        '#investment_holdings_panel [data-table-scroll] tr[data-investment-holdings-ticker="DRAM"]',
    );
    const lastPrice = holdingRow.locator('[data-investment-live-field="last"]');
    const unrealizedPnl = holdingRow.locator('[data-investment-live-field="unrealized_pnl"]');
    await expect(lastPrice).toHaveAttribute('data-investment-live-number', '49.4');
    await expect(lastPrice).toHaveAttribute('data-investment-live-display', '49.40');
    await expect(unrealizedPnl).toHaveAttribute('data-investment-live-display', '-30.30');

    const liveSummary = await page.evaluate(() => {
        const read = (field) => Number(
            document.querySelector(
                `#investment_holdings_panel [data-investment-live-field="${field}"]`,
            )?.dataset.investmentLiveNumber,
        );
        return {
            cash: read('summary_cash_balance'),
            marketValue: read('summary_market_value'),
            totalEquity: read('summary_total_equity'),
        };
    });
    expect(liveSummary.totalEquity).toBeCloseTo(
        liveSummary.cash + liveSummary.marketValue,
        8,
    );
});

test('keeps the realtime equity endpoint aligned with cash-equivalent Holdings', async ({page}) => {
    await page.addInitScript(() => {
        const RealDate = Date;
        const fixedTimestamp = new RealDate('2026-07-28T03:30:00Z').valueOf();
        class FixedDate extends RealDate {
            constructor(...args) {
                super(...(args.length ? args : [fixedTimestamp]));
            }

            static now() {
                return fixedTimestamp;
            }
        }
        window.Date = FixedDate;
    });
    await mockInvestmentReadApis(page, {
        transactions: [{
            ledger_no: 1,
            broker: 'hsbc',
            date: '2026-07-27',
            type: 'buy',
            ticker: 'SGOV',
            currency: 'USD',
            quantity: 1,
            price: 100.58,
            amount: -100.58,
        }],
        moneyMarketTickers: [],
        cashEquivalentTickers: ['SGOV'],
        priceHistoryByTicker: {
            SGOV: [{date: '2026-07-27', close: 100.58}],
        },
        realtimeQuotes: [{
            ticker: 'SGOV',
            price: 100.50,
            timestamp: '2026-07-27 23:30',
            session: 'overnight',
            session_date: '2026-07-28',
            market: 'US',
            source: 'longbridge',
        }],
        marketSession: {
            session: 'overnight',
            is_trading_day: true,
            is_realtime_allowed: true,
            session_date: '2026-07-28',
        },
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_holdings"]').click();
    const holdingRow = page.locator(
        '#investment_holdings_panel [data-table-scroll] tr[data-investment-holdings-ticker="SGOV"]',
    );
    await expect(holdingRow.locator('[data-investment-live-field="last"]')).toHaveAttribute(
        'data-investment-live-number',
        '100.5',
    );

    const endpoint = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const chartValues = chart?.data?.datasets?.[0]?.data || [];
        const holdingsTotal = Number(document.querySelector(
            '#investment_holdings_panel [data-investment-live-field="summary_total_equity"]',
        )?.dataset.investmentLiveNumber);
        return {
            chartTotal: Number(chartValues.at(-1)),
            holdingsTotal,
        };
    });
    expect(endpoint.chartTotal).toBeCloseTo(endpoint.holdingsTotal, 8);
});

test('keeps same-day HSBC USD settlement proceeds after earlier buys', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc'],
        transactions: [
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-06-30',
                datetime: '2026-06-30 19:00:00',
                type: 'deposit',
                currency: 'USD',
                amount: 20_000,
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-07-01',
                datetime: '2026-07-01 19:00:00',
                type: 'buy',
                ticker: 'BOXX',
                currency: 'USD',
                quantity: 1,
                price: 100,
                amount: -100,
                source: {
                    file_kind: 'hsbc_order_status_text',
                    statement_order_id: 'P-01-JUL-BUY',
                    cash_settlement_date: '2026-07-02',
                    cash_settlement_amount_raw: '-100.00',
                    cash_settlement_balance_after_raw: '19900.00',
                    cash_settlement_postings: [{
                        date: '2026-07-02',
                        amount_raw: '-100.00',
                        balance_after_raw: '19900.00',
                        source_file_kind: 'hsbc_usd_savings_csv',
                        ledger_sequence: 101,
                        currency: 'USD',
                        role: 'principal',
                    }],
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-07-01',
                datetime: '2026-07-01 20:00:00',
                type: 'sell',
                ticker: 'BOXX',
                currency: 'USD',
                quantity: 1,
                price: 100,
                amount: 100,
                source: {
                    file_kind: 'hsbc_order_status_text',
                    statement_order_id: 'P-01-JUL-SELL',
                    cash_settlement_date: '2026-07-02',
                    cash_settlement_amount_raw: '100.00',
                    cash_settlement_balance_after_raw: '20000.00',
                    cash_settlement_postings: [{
                        date: '2026-07-02',
                        amount_raw: '100.00',
                        balance_after_raw: '20000.00',
                        source_file_kind: 'hsbc_usd_savings_csv',
                        ledger_sequence: 102,
                        currency: 'USD',
                        role: 'principal',
                    }],
                },
            },
        ],
        priceHistoryByTicker: {
            BOXX: [
                {date: '2026-06-30', close: 100},
                {date: '2026-07-01', close: 100},
                {date: '2026-07-02', close: 100},
            ],
        },
    });
    await page.goto('/trade/investment?range=max');
    await expect.poll(() => page.evaluate(() => (
        window.Chart?.getChart(document.querySelector('#investmentEquityChart'))?.data?.rawLabels?.length || 0
    ))).toBeGreaterThan(0);

    const chartValues = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        return (chart?.data?.rawLabels || []).map((date, index) => ({
            date,
            value: Number(chart.data.datasets?.[0]?.data?.[index]),
        }));
    });
    // The later same-day sale boundary must remain the final cash state.
    expect(chartValues.find((point) => point.date === '2026-07-02')?.value).toBeCloseTo(20_000, 8);
});

test('replays future HSBC settlement cash on the settlement date without a derived transaction', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc'],
        transactions: [
            {
                broker: 'hsbc',
                account: '000-999999-999',
                date: '2026-05-30',
                type: 'withdrawal',
                currency: 'USD',
                amount: 0,
                description: 'Legacy USD balance snapshot',
                source: {
                    account_type: 'Foreign Currency Savings USD',
                    balance_after_raw: '0.00',
                    file_kind: 'hsbc_statement_cash',
                },
            },
            {
                broker: 'hsbc',
                account: '000-999999-999',
                date: '2026-05-31',
                type: 'withdrawal',
                currency: 'USD',
                amount: -24_373.75,
                description: 'Unscoped historical USD replay delta',
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-06-22',
                datetime: '2026-06-22 20:00:00',
                type: 'deposit',
                currency: 'USD',
                amount: 1000,
                net_amount_raw: '1000.00',
                source: {
                    file_kind: 'hsbc_usd_savings_csv',
                    row_number: 104,
                    ledger_sequence: 104,
                    cash_balance_authoritative: true,
                    balance_after_raw: '11000.00',
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-06-22',
                datetime: '2026-06-22 21:00:00',
                type: 'buy',
                ticker: 'BOXX',
                currency: 'USD',
                quantity: 1,
                price: 900,
                amount: -900,
                source: {
                    file_kind: 'hsbc_order_status_text',
                    statement_order_id: 'P-TEST',
                    // Matched SEC evidence clears the provisional pending flag.
                    // Trade-date equity must remain correct without that flag.
                    cash_settlement_date: '2026-06-23',
                    cash_settlement_amount_raw: '-900.00',
                    cash_settlement_balance_after_raw: '10600.00',
                    cash_settlement_reference: 'REF PTEST001 SEC',
                    cash_settlement_source_row_number: 102,
                    cash_settlement_postings: [{
                        date: '2026-06-23',
                        amount_raw: '-900.00',
                        balance_after_raw: '10600.00',
                        reference: 'REF PTEST001 SEC',
                        row_number: 102,
                        ledger_sequence: 102,
                        source_file_kind: 'hsbc_usd_savings_csv',
                        currency: 'USD',
                        role: 'principal',
                    }],
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-06-23',
                datetime: '2026-06-23 20:00:00',
                type: 'deposit',
                currency: 'USD',
                amount: 500,
                net_amount_raw: '500.00',
                source: {
                    file_kind: 'hsbc_usd_savings_csv',
                    row_number: 101,
                    ledger_sequence: 101,
                    cash_balance_authoritative: true,
                    balance_after_raw: '11500.00',
                },
            },
        ],
        priceHistoryByTicker: {
            BOXX: [
                {date: '2026-06-22', close: 1000},
                {date: '2026-06-23', close: 1000},
            ],
        },
    });
    await page.goto('/trade/investment?range=max');
    await expect.poll(() => page.evaluate(() => (
        window.Chart?.getChart(document.querySelector('#investmentEquityChart'))?.data?.rawLabels?.length || 0
    ))).toBeGreaterThan(0);

    const chartValues = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        return (chart?.data?.rawLabels || []).map((date, index) => ({
            date,
            value: Number(chart.data.datasets?.[0]?.data?.[index]),
        }));
    });
    // The order-day equity includes the signed settlement payable: settled
    // cash 11,000 - payable 900 + BOXX market value 1,000.
    expect(chartValues.find((point) => point.date === '2026-06-22')?.value).toBeCloseTo(11100, 8);
    expect(chartValues.find((point) => point.date === '2026-06-23')?.value).toBeCloseTo(11600, 8);
    const settledOrderRow = page.locator('#investment_history_row_2');
    await expect(settledOrderRow.locator('td').nth(9)).not.toContainText('*');
    await expect(settledOrderRow.locator('td').nth(10)).not.toContainText('*');
    await expect(
        page.locator('#investment_history .investment-history-cell-left')
            .filter({hasText: 'BOXX @ 900.00 × 1'})
            .first(),
    ).toHaveText('BOXX @ 900.00 × 1 · P-TEST');
    await expect(page.getByText('HSBC cash settlement replay', {exact: true})).toHaveCount(0);
    await expect(page.locator('#investment_history tr[data-investment-history-row]')).toHaveCount(5);
});

test('keeps overlapping HSBC trade-date payables continuous across 22–24 Jun 2026', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc'],
        transactions: [
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-06-22',
                datetime: '2026-06-22 19:00:00',
                type: 'deposit',
                currency: 'USD',
                amount: 20_000,
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-06-22',
                datetime: '2026-06-22 20:00:00',
                type: 'buy',
                ticker: 'BOXX',
                currency: 'USD',
                quantity: 1,
                price: 17_112.34,
                amount: -17_112.34,
                source: {
                    file_kind: 'hsbc_order_status_text',
                    statement_order_id: 'P-22-JUN',
                    cash_settlement_date: '2026-06-23',
                    cash_settlement_amount_raw: '-17112.34',
                    cash_settlement_balance_after_raw: '20246.55',
                    cash_settlement_postings: [{
                        date: '2026-06-23',
                        amount_raw: '-17112.34',
                        balance_after_raw: '20246.55',
                        source_file_kind: 'hsbc_statement_cash',
                        ledger_sequence: 220,
                        currency: 'USD',
                        role: 'principal',
                    }],
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-06-23',
                datetime: '2026-06-23 19:00:00',
                type: 'deposit',
                currency: 'USD',
                amount: 7_358.89,
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-06-23',
                datetime: '2026-06-23 20:00:00',
                type: 'buy',
                ticker: 'EUV',
                currency: 'USD',
                quantity: 1,
                price: 1_844.80,
                amount: -1_844.80,
                source: {
                    file_kind: 'hsbc_order_status_text',
                    statement_order_id: 'P-23-JUN',
                    cash_settlement_date: '2026-06-24',
                    cash_settlement_amount_raw: '-1844.80',
                    cash_settlement_balance_after_raw: '18401.75',
                    cash_settlement_postings: [{
                        date: '2026-06-24',
                        amount_raw: '-1844.80',
                        balance_after_raw: '18401.75',
                        source_file_kind: 'hsbc_statement_cash',
                        ledger_sequence: 230,
                        currency: 'USD',
                        role: 'principal',
                    }],
                },
            },
        ],
        priceHistoryByTicker: {
            BOXX: [
                {date: '2026-06-22', close: 17_112.34},
                {date: '2026-06-23', close: 17_112.34},
                {date: '2026-06-24', close: 17_112.34},
            ],
            EUV: [
                {date: '2026-06-23', close: 1_844.80},
                {date: '2026-06-24', close: 1_844.80},
            ],
        },
    });
    await page.goto('/trade/investment?range=max');
    await expect.poll(() => page.evaluate(() => (
        window.Chart?.getChart(document.querySelector('#investmentEquityChart'))?.data?.rawLabels?.length || 0
    ))).toBeGreaterThan(0);

    const chartValues = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        return (chart?.data?.rawLabels || []).map((date, index) => ({
            date,
            value: Number(chart.data.datasets?.[0]?.data?.[index]),
        }));
    });
    expect(chartValues.find((point) => point.date === '2026-06-22')?.value).toBeCloseTo(30_000, 8);
    expect(chartValues.find((point) => point.date === '2026-06-23')?.value).toBeCloseTo(37_358.89, 8);
    expect(chartValues.find((point) => point.date === '2026-06-24')?.value).toBeCloseTo(37_358.89, 8);
});

test('anchors HSBC History cash to an evidenced future SEC settlement balance', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc'],
        transactions: [
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-05',
                type: 'deposit',
                currency: 'USD',
                amount: 0,
                source: {
                    file_kind: 'hsbc_usd_account_text',
                    balance_after_raw: '13000.00',
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-06',
                type: 'sell',
                ticker: 'DRAM',
                currency: 'USD',
                quantity: 2,
                price: 52.35,
                amount: 104.69,
                source: {
                    cash_replay_pending_settlement: true,
                    cash_settlement_date: '2026-08-07',
                    cash_settlement_amount_raw: '104.69',
                    cash_settlement_balance_after_raw: '20976.10',
                    cash_flow_fee_amount_raw: '0.01',
                    cash_settlement_reference: 'REF S900040001 SEC',
                },
            },
        ],
        priceHistoryByTicker: {
            DRAM: [{date: '2026-08-06', close: 52.35}],
        },
    });
    await page.goto('/trade/investment?range=max');

    const sellRow = page.locator('#investment_history_row_2');
    await expect(sellRow.locator('td').nth(9)).toContainText('20,976.10');
    await expect(sellRow.locator('td').nth(9)).not.toContainText('*');
});

test('keeps HSBC unsettled buy history sequential while current cash stays current', async ({page}) => {
    const pendingBuys = [
        ['DRAM', 5, 57.00, 285.00],
        ['EUV', 1, 25.75, 25.75],
        ['EUV', 1, 25.70, 25.70],
        ['DRAM', 1, 55.75, 55.75],
        ['EUV', 1, 25.50, 25.50],
        ['DRAM', 1, 55.00, 55.00],
        ['QQQI', 5, 55.14, 275.70],
        ['EUV', 1, 25.50, 25.50],
        ['DRAM', 3, 55.00, 165.00],
    ];
    const transactions = [
        {
            broker: 'hsbc',
            account: 'HSBC-TEST',
            date: '2026-08-18',
            datetime: '2026-08-17 08:00:00',
            type: 'sell',
            currency: 'USD',
            ticker: 'DRAM',
            quantity: 1,
            price: 1000,
            amount: 1000,
            source: {
                cash_settlement_date: '2026-08-20',
                cash_settlement_amount_raw: '1000.00',
                cash_settlement_balance_after_raw: '13231.60',
                cash_settlement_postings: [{
                    date: '2026-08-20',
                    amount_raw: '1000.00',
                    balance_after_raw: '13231.60',
                    currency: 'USD',
                    role: 'principal',
                }],
                order_id: 'S-TEST-1',
            },
        },
        ...pendingBuys.map(([ticker, quantity, price, amount], index) => ({
            broker: 'hsbc',
            account: 'HSBC-TEST',
            date: '2026-08-18',
            datetime: `2026-08-18 ${String(9 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00`,
            type: 'buy',
            ticker,
            currency: 'USD',
            quantity,
            price,
            amount: -amount,
            source: {
                cash_replay_pending_settlement: true,
                order_id: `P-TEST-${index + 1}`,
            },
        })),
    ];
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc'],
        transactions,
        summary: {
            authoritative_current_cash_brokers: ['hsbc'],
        },
        brokerSummaries: {
            hsbc: {
                broker: 'hsbc',
                account_id: 'HSBC-TEST',
                cash_snapshot_authoritative: true,
                ending_cash_base_currency: '23413.41',
                ending_cash_by_currency: {USD: '23413.41'},
                hsbc_pending_settlement_cash: '-938.900',
                hsbc_broker_cash_estimate: '22474.510',
                position_snapshot_as_of: '2026-08-18',
            },
        },
        priceHistoryByTicker: {
            DRAM: [
                {date: '2026-08-17', close: 1000.00},
                {date: '2026-08-18', close: 55.00},
            ],
            EUV: [{date: '2026-08-18', close: 25.50}],
            QQQI: [{date: '2026-08-18', close: 55.14}],
        },
    });
    await page.goto('/trade/investment');

    const firstBuyRow = page.locator('#investment_history_row_2');
    const latestBuyRow = page.locator('#investment_history_row_10');
    await expect(firstBuyRow.locator('td').nth(9)).toContainText('*26,360.01');
    await expect(latestBuyRow.locator('td').nth(9)).toContainText('*25,706.11');
    await expect(
        page.locator('#investment_history .investment-history-cell-left')
            .filter({hasText: 'DRAM @ 57.00 × 5'})
            .first(),
    ).toHaveText('DRAM @ 57.00 × 5 · P-TEST-1*');

    await page.locator('label[for="investment_view_holdings"]').click();
    const currentCash = page.locator(
        '#investment_holdings_panel [data-investment-live-field="summary_cash_balance"]',
    );
    await expect(currentCash).toHaveAttribute('data-investment-live-display', '*22,474.51');
});

test('anchors the latest IBKR buy to the verified current cash snapshot', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['ibkr'],
        startingCash: 0,
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                account: 'IBKR-TEST',
                date: '2026-08-18',
                datetime: '2026-08-18 03:00:00',
                type: 'deposit',
                currency: 'USD',
                // Preserve sub-cent source precision to verify the visible
                // cent-level history replay rather than hidden-fraction drift.
                amount: 1215.376,
            },
            {
                ledger_no: 2,
                broker: 'ibkr',
                account: 'IBKR-TEST',
                date: '2026-08-18',
                datetime: '2026-08-18 03:33:23',
                type: 'buy',
                ticker: 'DRAM',
                currency: 'USD',
                quantity: 5,
                price: 58,
                amount: -290.34827225,
            },
            {
                ledger_no: 3,
                broker: 'ibkr',
                account: 'IBKR-TEST',
                date: '2026-08-18',
                datetime: '2026-08-18 05:00:47',
                type: 'buy',
                ticker: 'DRAM',
                currency: 'USD',
                quantity: 5,
                price: 57,
                amount: -285.34327225,
            },
        ],
        summary: {
            authoritative_current_cash_brokers: ['ibkr'],
        },
        brokerSummaries: {
            ibkr: {
                broker: 'ibkr',
                account_id: 'IBKR-TEST',
                cash_snapshot_authoritative: true,
                ending_cash: '950.49',
                ending_cash_base_currency: '950.49',
                ending_cash_as_of: '2026-08-18',
                ending_cash_replay_as_of: '2026-08-18',
                ending_cash_as_of_datetime: '2026-08-18 05:00:47',
                ending_cash_replay_as_of_datetime: '2026-08-18 05:00:47',
            },
        },
        priceHistoryByTicker: {
            DRAM: [{date: '2026-08-18', close: 57.00}],
        },
    });
    await page.goto('/trade/investment');

    const firstBuyRow = page.locator('#investment_history_row_2');
    const latestBuyRow = page.locator('#investment_history_row_3');
    await expect(firstBuyRow.locator('td').nth(9)).toContainText('925.03');
    await expect(latestBuyRow.locator('td').nth(9)).toContainText('950.49');

    await page.locator('label[for="investment_view_holdings"]').click();
    await expect(
        page.locator('#investment_holdings_panel [data-investment-live-field="summary_cash_balance"]'),
    ).toHaveAttribute('data-investment-live-display', '950.49');

    await page.locator('label[for="investment_view_metrics"]').click();
    await expect(
        page.locator('#investment_metrics_panel [data-investment-live-field="metrics_cash"]'),
    ).toHaveAttribute('data-investment-live-display', '950.49');
});

test('keeps HSBC buy and sell equity conserved across 30 Jun–2 Jul settlement dates', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc'],
        transactions: [
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-06-30',
                type: 'deposit',
                currency: 'USD',
                amount: 10_000,
                source: {
                    file_kind: 'hsbc_usd_savings_csv',
                    cash_balance_authoritative: true,
                    balance_after_raw: '10000.00',
                    ledger_sequence: 301,
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-06-30',
                type: 'buy',
                ticker: 'BOXX',
                currency: 'USD',
                quantity: 1,
                price: 900,
                amount: -900,
                source: {
                    file_kind: 'hsbc_order_status_text',
                    cash_replay_pending_settlement: true,
                    cash_settlement_date: '2026-07-01',
                    cash_settlement_amount_raw: '-900.00',
                    cash_settlement_balance_after_raw: '9100.00',
                    cash_settlement_postings: [{
                        date: '2026-07-01',
                        amount_raw: '-900.00',
                        balance_after_raw: '9100.00',
                        source_file_kind: 'hsbc_usd_savings_csv',
                        ledger_sequence: 302,
                        currency: 'USD',
                        role: 'principal',
                    }],
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-07-01',
                type: 'deposit',
                currency: 'USD',
                amount: 0,
                source: {
                    file_kind: 'hsbc_usd_savings_csv',
                    cash_balance_authoritative: true,
                    balance_after_raw: '9100.00',
                    ledger_sequence: 303,
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-07-02',
                type: 'sell',
                ticker: 'BOXX',
                currency: 'USD',
                quantity: 1,
                price: 900,
                amount: 900,
                source: {
                    file_kind: 'hsbc_order_status_text',
                    cash_replay_pending_settlement: true,
                    cash_settlement_date: '2026-07-03',
                    cash_settlement_amount_raw: '900.00',
                    cash_settlement_balance_after_raw: '10000.00',
                    cash_settlement_postings: [{
                        date: '2026-07-03',
                        amount_raw: '900.00',
                        balance_after_raw: '10000.00',
                        source_file_kind: 'hsbc_usd_savings_csv',
                        ledger_sequence: 304,
                        currency: 'USD',
                        role: 'principal',
                    }],
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-07-03',
                type: 'deposit',
                currency: 'USD',
                amount: 0,
                source: {
                    file_kind: 'hsbc_usd_savings_csv',
                    cash_balance_authoritative: true,
                    balance_after_raw: '10000.00',
                    ledger_sequence: 305,
                },
            },
        ],
        priceHistoryByTicker: {
            BOXX: [
                {date: '2026-06-30', close: 900},
                {date: '2026-07-01', close: 900},
                {date: '2026-07-02', close: 900},
                {date: '2026-07-03', close: 900},
            ],
        },
    });
    await page.goto('/trade/investment?range=max');
    await expect.poll(() => page.evaluate(() => (
        window.Chart?.getChart(document.querySelector('#investmentEquityChart'))?.data?.rawLabels?.length || 0
    ))).toBeGreaterThan(0);

    const chartValues = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        return (chart?.data?.rawLabels || []).map((date, index) => ({
            date,
            value: Number(chart.data.datasets?.[0]?.data?.[index]),
        }));
    });
    for (const date of ['2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03']) {
        expect(chartValues.find((point) => point.date === date)?.value).toBeCloseTo(10_000, 8);
    }
});

test('keeps HSBC account-type cash boundaries out of a 6457-shaped cash spike', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc'],
        transactions: [
            {
                broker: 'hsbc',
                account: '000-999999-999',
                date: '2026-06-01',
                type: 'deposit',
                currency: 'HKD',
                amount: 27_462.16,
                source: {
                    account_type: 'HKD Savings',
                    balance_after_raw: '27462.16',
                    file_kind: 'hsbc_multi_currency_cash_account_text',
                },
            },
            {
                broker: 'hsbc',
                account: '000-999999-999',
                date: '2026-06-02',
                type: 'deposit',
                currency: 'HKD',
                amount: 0,
                description: 'HKD Savings balance snapshot',
                source: {
                    account_type: 'HKD Savings',
                    balance_after_raw: '89.24',
                    file_kind: 'hsbc_multi_currency_cash_account_text',
                },
            },
            {
                broker: 'hsbc',
                account: '000-999999-999',
                date: '2026-06-03',
                type: 'deposit',
                currency: 'USD',
                amount: 11_108.38,
                source: {
                    account_type: 'USD Savings',
                    balance_after_raw: '21108.38',
                    file_kind: 'hsbc_usd_account_text',
                },
            },
            {
                broker: 'hsbc',
                account: '000-999999-999',
                date: '2026-06-04',
                type: 'withdrawal',
                currency: 'CNH',
                amount: 0,
                description: 'RMB Savings balance snapshot',
                source: {
                    account_type: 'RMB Savings',
                    balance_after_raw: '0.00',
                    file_kind: 'hsbc_multi_currency_cash_account_text',
                },
            },
        ],
        fxRateHistoryByCurrency: {
            HKD: {dates: ['2026-06-04'], values: {'2026-06-04': 7.8}},
        },
    });
    await page.goto('/trade/investment?range=max');
    const cnhRow = page.locator('#investment_history_row_4');
    await expect(cnhRow).toHaveCount(1);
    const cashText = await cnhRow.locator('td').nth(9).innerText();
    const cashValue = Number(cashText.replace(/[^\d.-]/g, ''));
    expect(cashValue).toBeCloseTo(21_119.82, 2);
    expect(cashValue).toBeLessThan(22_000);
});

test('keeps the HSBC pending-settlement marker separate from FX conversion', async ({page}) => {
    await page.addInitScript(() => {
        const RealDate = Date;
        const fixedTimestamp = new RealDate('2026-08-20T12:00:00').valueOf();
        class FixedDate extends RealDate {
            constructor(...args) {
                super(...(args.length ? args : [fixedTimestamp]));
            }

            static now() {
                return fixedTimestamp;
            }
        }
        window.Date = FixedDate;
    });
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'ibkr', 'schwab'],
        transactions: [
            {ledger_no: 1, broker: 'hsbc', date: '2026-08-14', type: 'deposit', currency: 'USD', amount: 0},
            {
                ledger_no: 2,
                broker: 'ibkr',
                date: '2026-08-14',
                type: 'buy',
                ticker: 'TEST',
                currency: 'USD',
                quantity: 1,
                price: 1,
                amount: -1,
            },
            {ledger_no: 3, broker: 'schwab', date: '2026-08-15', type: 'deposit', currency: 'USD', amount: 0},
        ],
        priceHistoryByTicker: {
            TEST: [{date: '2026-08-14', close: 1}],
        },
        summary: {
            authoritative_current_cash_brokers: ['hsbc', 'ibkr', 'schwab'],
        },
        brokerSummaries: {
            hsbc: {
                broker: 'hsbc',
                cash_snapshot_authoritative: true,
                ending_cash: '23412.54',
                ending_cash_base_currency: '23412.54',
                ending_cash_as_of: '2026-08-19',
                ending_cash_by_currency: {
                    USD: '23412.54',
                    HKD: '89.24',
                    CNH: '0.00',
                },
                hsbc_bank_available_cash: '23388.54',
                cash_ledger_balance: '23412.54',
                hsbc_broker_cash_estimate: '23387.940',
                hsbc_pending_settlement_cash: '-24.600',
                hsbc_pending_settlement_order_count: 1,
            },
            ibkr: {
                broker: 'ibkr',
                cash_snapshot_authoritative: true,
                ending_cash: '950.49',
                ending_cash_base_currency: '950.49',
                ending_cash_as_of: '2026-08-19',
            },
            schwab: {
                broker: 'schwab',
                cash_snapshot_authoritative: true,
                ending_cash: '0.41',
                ending_cash_base_currency: '0.41',
                ending_cash_as_of: '2026-08-15',
            },
        },
        fxRateHistoryByCurrency: {
            HKD: {
                dates: ['2026-08-19'],
                values: {'2026-08-19': 7.842899799346924},
            },
        },
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_holdings"]').click();

    const cash = page.locator(
        '#investment_holdings_panel [data-investment-live-field="summary_cash_balance"]',
    );
    const totalEquity = page.locator(
        '#investment_holdings_panel [data-investment-live-field="summary_total_equity"]',
    );
    await expect(cash).toHaveAttribute('data-investment-live-display', '*24,350.22');
    expect(Number(await cash.getAttribute('data-investment-live-number'))).toBeCloseTo(
        23_387.94 + (89.24 / 7.842899799346924) + 950.49 + 0.41,
        8,
    );
    expect(Number(await totalEquity.getAttribute('data-investment-live-number'))).toBeCloseTo(
        Number(await cash.getAttribute('data-investment-live-number')) + 1,
        8,
    );

    await page.locator('label[for="investment_view_metrics"]').click();
    const brokerSelector = page.locator(
        '#investment_metrics_panel_shell [data-investment-broker-filter-trigger]',
    );
    await brokerSelector.click();
    await page.getByRole('option', {name: 'HSBC', exact: true}).click();
    const metricsCash = page.locator(
        '#investment_metrics_panel [data-investment-live-field="metrics_cash"]',
    );
    await expect(metricsCash).toHaveAttribute(
        'data-investment-live-display',
        '*23,399.32',
    );
    expect(Number(await metricsCash.getAttribute('data-investment-live-number'))).toBeCloseTo(
        23_387.94 + (89.24 / 7.842899799346924),
        8,
    );
});

test('sums HSBC, IBKR, and Schwab current cash before adding holdings equity', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'ibkr', 'schwab'],
        transactions: [
            {
                ledger_no: 1,
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-18',
                datetime: '2026-08-18 10:00:00',
                type: 'deposit',
                currency: 'USD',
                amount: 26360.01,
            },
            {
                ledger_no: 2,
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-18',
                datetime: '2026-08-18 10:01:00',
                type: 'buy',
                ticker: 'TEST',
                currency: 'USD',
                quantity: 1,
                price: 653.90,
                amount: -653.90,
                source: {
                    cash_replay_pending_settlement: true,
                },
            },
            {
                ledger_no: 3,
                broker: 'ibkr',
                account: 'IBKR-TEST',
                date: '2026-08-18',
                type: 'deposit',
                currency: 'USD',
                amount: 0,
            },
            {
                ledger_no: 4,
                broker: 'schwab',
                account: 'SCHWAB-TEST',
                date: '2026-08-18',
                type: 'deposit',
                currency: 'USD',
                amount: 0,
            },
        ],
        priceHistoryByTicker: {
            TEST: [{date: '2026-08-18', close: 653.90}],
        },
        summary: {
            authoritative_current_cash_brokers: ['hsbc', 'ibkr', 'schwab'],
        },
        brokerSummaries: {
            hsbc: {
                broker: 'hsbc',
                cash_snapshot_authoritative: true,
                ending_cash: '23387.94',
                ending_cash_base_currency: '23387.94',
                ending_cash_as_of: '2026-08-19',
                ending_cash_by_currency: {
                    USD: '23387.94',
                    HKD: '89.24',
                },
                hsbc_bank_available_cash: '23388.54',
                cash_ledger_balance: '23387.94',
                hsbc_broker_cash_estimate: '23387.940',
                hsbc_pending_settlement_cash: '0.000',
                hsbc_pending_settlement_order_count: 0,
            },
            ibkr: {
                broker: 'ibkr',
                cash_snapshot_authoritative: true,
                ending_cash: '950.49',
                ending_cash_as_of: '2026-08-19',
            },
            schwab: {
                broker: 'schwab',
                cash_snapshot_authoritative: true,
                ending_cash: '0.41',
                ending_cash_as_of: '2026-08-18',
            },
        },
        fxRateHistoryByCurrency: {
            HKD: {
                dates: ['2026-08-18'],
                values: {'2026-08-18': 7.842899799346924},
            },
        },
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_holdings"]').click();

    const cash = page.locator(
        '#investment_holdings_panel [data-investment-live-field="summary_cash_balance"]',
    );
    const totalEquity = page.locator(
        '#investment_holdings_panel [data-investment-live-field="summary_total_equity"]',
    );
    await expect(cash).toHaveAttribute('data-investment-live-display', '24,350.22');
    await expect(totalEquity).toHaveAttribute('data-investment-live-display', '25,004.12');
});

test('keeps HSBC pending-sell cash source-bounded in history and equity', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc'],
        transactions: [
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-01',
                type: 'buy',
                ticker: 'EUV',
                currency: 'USD',
                quantity: 86,
                price: 20,
                amount: -1720,
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-01',
                type: 'buy',
                ticker: 'DRAM',
                currency: 'USD',
                quantity: 206,
                price: 40,
                amount: -8240,
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-04',
                datetime: '2026-08-04 20:00:00',
                type: 'sell',
                ticker: 'EUV',
                currency: 'USD',
                quantity: 6,
                price: 25.58,
                amount: 153.48,
                normalized: {
                    net_amount: '153.48',
                    gross_amount: '153.48',
                    position_quantity: '6',
                    unit_price: '25.58',
                },
                source: {
                    cash_replay_pending_settlement: true,
                    // A malformed legacy value is not settlement evidence.
                    cash_settlement_amount_raw: 'NaN',
                    order_id: 'S-900002',
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-04',
                datetime: '2026-08-04 20:00:01',
                type: 'sell',
                ticker: 'DRAM',
                currency: 'USD',
                quantity: 6,
                price: 54.62,
                amount: 327.72,
                normalized: {
                    net_amount: '327.72',
                    gross_amount: '327.72',
                    position_quantity: '6',
                    unit_price: '54.62',
                },
                source: {
                    cash_replay_pending_settlement: true,
                    order_id: 'S-900003',
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-04',
                datetime: '2026-08-04 20:00:02',
                type: 'withdrawal',
                currency: 'CNH',
                amount: -500.01,
                normalized: {net_amount: '-500.01'},
                source: {
                    file_kind: 'hsbc_multi_currency_cash_account_text',
                    account_number: 'HSBC-TEST',
                },
            },
        ],
        brokerSummaries: {
            hsbc: {
                broker: 'hsbc',
                account_id: 'HSBC-TEST',
                ending_cash: '20444.97',
                ending_cash_base_currency: '20444.97',
                ending_cash_by_currency: {
                    CNH: '500.01',
                    HKD: '530.87',
                    USD: '20444.97',
                },
                position_snapshot_authoritative: true,
                position_snapshot: {
                    EUV: {quantity: '80', market_value: '2060', last_price: '25.75'},
                    DRAM: {quantity: '200', market_value: '10980', last_price: '54.90'},
                },
            },
        },
        summary: {position_snapshot_authoritative: true},
        positionSnapshot: {
            EUV: {quantity: '80', market_value: '2060', last_price: '25.75'},
            DRAM: {quantity: '200', market_value: '10980', last_price: '54.90'},
        },
        priceHistoryByTicker: {
            EUV: [{date: '2026-08-04', close: 25.75}],
            DRAM: [{date: '2026-08-04', close: 54.90}],
        },
        intradayRows: (url) => {
            const ticker = url.searchParams.get('ticker');
            const days = (url.searchParams.get('days') || '').split(',').filter(Boolean);
            const close = ticker === 'EUV' ? 25.50 : 55.00;
            return days.flatMap((day) => [
                {date: `${day} 15:59`, open: close, high: close, low: close, close: close - 0.10},
                {date: `${day} 16:00`, open: close, high: close, low: close, close},
            ]);
        },
        fxRateHistoryByCurrency: {
            CNH: {dates: ['2026-08-04'], values: {'2026-08-04': 7.2}},
            HKD: {dates: ['2026-08-04'], values: {'2026-08-04': 7.8}},
        },
    });
    await page.goto('/trade/investment');

    const euvSellRow = page.locator('#investment_history_row_3');
    const dramSellRow = page.locator('#investment_history_row_4');
    await expect(euvSellRow.locator('td').nth(8)).toContainText('13,370.00');
    await expect(dramSellRow.locator('td').nth(8)).toContainText('13,040.00');
    await expect(euvSellRow.locator('td').nth(9)).toContainText('*20,598.45');
    await expect(dramSellRow.locator('td').nth(9)).toContainText('*20,926.17');
    await expect(euvSellRow.locator('td').nth(10)).toContainText('*33,968.45');
    await expect(dramSellRow.locator('td').nth(10)).toContainText('*33,966.17');
    const cnhWithdrawalRow = page.locator('#investment_history_row_5');
    await expect(cnhWithdrawalRow.locator('td').nth(8)).not.toContainText('*');
    await expect(cnhWithdrawalRow.locator('td').nth(9)).toContainText(/^\*/);
    await expect(cnhWithdrawalRow.locator('td').nth(10)).toContainText(/^\*/);
    const exportButton = page.locator('#export_transactions_button');
    const downloadPromise = page.waitForEvent('download');
    await exportButton.click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const markdown = await readFile(downloadPath, 'utf8');
    expect(markdown).not.toContain('*20,598.45');
    expect(markdown).not.toContain('*33,968.45');

    await page.locator('label[for="investment_view_holdings"]').click();
    const liveSummary = await page.evaluate(() => {
        const read = (field) => Number(
            document.querySelector(
                `#investment_holdings_panel [data-investment-live-field="${field}"]`,
            )?.dataset.investmentLiveNumber,
        );
        return {
            cash: read('summary_cash_balance'),
            marketValue: read('summary_market_value'),
            totalEquity: read('summary_total_equity'),
        };
    });
    expect(liveSummary.totalEquity).toBeCloseTo(
        liveSummary.cash + liveSummary.marketValue,
        8,
    );
});

test('keeps actual aggregate cash after an internal subaccount bridge', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['futuhk'],
        transactions: [
            {
                broker: 'futuhk',
                account: 'FUTU-TEST',
                date: '2023-02-16',
                type: 'deposit',
                currency: 'USD',
                amount: 1271.50,
                normalized: {net_amount: '1271.50'},
                internal_transfer_external_flow_excluded: true,
            },
            {
                broker: 'futuhk',
                account: 'FUTU-TEST',
                date: '2023-02-16',
                type: 'buy',
                ticker: 'TST',
                currency: 'USD',
                quantity: 1,
                price: 10,
                amount: -10,
            },
            {
                broker: 'futuhk',
                account: 'FUTU-TEST',
                date: '2023-03-28',
                type: 'withdrawal',
                currency: 'USD',
                amount: -1271.50,
                normalized: {net_amount: '-1271.50'},
            },
        ],
        priceHistoryByTicker: {
            TST: [
                {date: '2023-02-16', close: 10},
                {date: '2023-03-28', close: 10},
            ],
        },
    });
    await page.goto('/trade/investment?range=max');
    await page.locator('label[for="investment_view_holdings"]').click();

    const liveSummary = new Map([
        ['summary_cash_balance', '9990'],
        ['summary_cash_equivalents', '9990'],
        ['summary_market_value', '10'],
        ['summary_total_equity', '10000'],
    ]);
    for (const [field, expectedValue] of liveSummary) {
        await expect(page.locator(
            `#investment_holdings_panel [data-investment-live-field="${field}"]`,
        )).toHaveAttribute('data-investment-live-number', expectedValue);
    }
    const chartValues = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const values = new Map((chart?.data?.rawLabels || []).map((date, index) => [
            date,
            chart?.data?.datasets?.[0]?.data?.[index],
        ]));
        return {
            bridgeDate: values.get('2023-02-16'),
            finalDate: values.get('2023-03-28'),
        };
    });
    expect(chartValues.bridgeDate).toBe(10000);
    expect(chartValues.finalDate).toBe(10000);
});

test('renders incomplete historical valuations as unavailable instead of zero', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                account: 'IBKR-TEST',
                date: '2024-05-03',
                type: 'buy',
                ticker: 'AMD',
                currency: 'USD',
                quantity: 10,
                price: 10,
                amount: -100,
            },
        ],
    });

    await page.goto('/trade/investment?range=max');

    const row = page.locator('#investment_history_row_1');
    await expect(row.locator('td').nth(8)).toHaveText('--');
    await expect(row.locator('td').nth(10)).toHaveText('--');
    const chartValue = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const index = chart?.data?.rawLabels?.indexOf('2024-05-03') ?? -1;
        return index >= 0 ? chart?.data?.datasets?.[0]?.data?.[index] : undefined;
    });
    expect(chartValue).toBeNull();
});

test('keeps the latest yfinance post-market quote when Longbridge overnight data is unavailable', async ({page}) => {
    await page.addInitScript(() => {
        const RealDate = Date;
        const fixedTimestamp = new RealDate('2026-07-28T03:30:00Z').valueOf();
        class FixedDate extends RealDate {
            constructor(...args) {
                super(...(args.length ? args : [fixedTimestamp]));
            }

            static now() {
                return fixedTimestamp;
            }
        }
        window.Date = FixedDate;
    });
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                date: '2026-07-27',
                type: 'buy',
                ticker: 'DRAM',
                currency: 'USD',
                quantity: 10,
                price: 52.43,
                amount: -524.30,
            },
        ],
        priceHistoryByTicker: {
            DRAM: [
                {date: '2026-07-24', close: 53.20},
                {date: '2026-07-27', close: 52.43},
            ],
        },
        realtimeQuotes: [{
            ticker: 'DRAM',
            price: 51.80,
            timestamp: '2026-07-27 19:59',
            session: 'post',
            session_date: '2026-07-27',
            market: 'US',
            source: 'yfinance',
        }],
        marketSession: {
            session: 'overnight',
            is_trading_day: true,
            is_realtime_allowed: true,
            session_date: '2026-07-28',
        },
    });
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_holdings"]').click();

    const holdingRow = page.locator(
        '#investment_holdings_panel [data-table-scroll] tr[data-investment-holdings-ticker="DRAM"]',
    );
    const lastPrice = holdingRow.locator('[data-investment-live-field="last"]');
    const unrealizedPnl = holdingRow.locator('[data-investment-live-field="unrealized_pnl"]');
    await expect(lastPrice).toHaveAttribute('data-investment-live-display', '51.80');
    await expect(unrealizedPnl).toHaveAttribute('data-investment-live-display', '-6.30');
    await expect(page.locator('[data-investment-equity-live-marker]')).toBeHidden();
});

test('anchors the Overview live marker to Hong Kong\'s current date after the US session closes', async ({page}) => {
    await page.addInitScript(() => {
        const RealDate = Date;
        const fixedTimestamp = new RealDate('2026-07-23T06:00:00Z').valueOf();
        class FixedDate extends RealDate {
            constructor(...args) {
                super(...(args.length ? args : [fixedTimestamp]));
            }

            static now() {
                return fixedTimestamp;
            }
        }
        window.Date = FixedDate;
    });
    await mockInvestmentReadApis(page, {
        transactions: [
            {ledger_no: 1, broker: 'longbridge_hk', date: '2026-07-22', type: 'buy', ticker: '700.HK', currency: 'HKD', quantity: 10, price: 400, amount: -4000},
        ],
        priceHistoryByTicker: {
            '700.HK': [
                {date: '2026-07-21', close: 398},
                {date: '2026-07-22', close: 400},
            ],
        },
        realtimeQuotes: [{
            ticker: '700.HK',
            price: 405,
            timestamp: '2026-07-23 14:00',
            session: 'intraday',
            session_date: '2026-07-23',
            market: 'HK',
            source: 'yfinance',
        }],
        marketSession: {
            session: 'off',
            is_trading_day: true,
            is_realtime_allowed: false,
            session_date: '2026-07-22',
        },
    });
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment');

    const marker = page.locator('[data-investment-equity-live-marker]');
    await expect.poll(() => marker.evaluate((element) => !element.hidden)).toBe(true);
    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const labels = chart?.data?.labels || [];
        return String(labels[labels.length - 1] || '');
    })).toBe('2026-07-23');
});

test('exports a semantically labeled Investment Markdown report with its active scope', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                date: '2026-07-21',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 1,
                price: 500,
                amount: -500,
                commission: 1,
            },
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-07-21', close: 500},
                {date: '2026-07-22', close: 505},
            ],
        },
    });
    await page.goto('/trade/investment');

    const exportButton = page.locator('#export_transactions_button');
    await expect(exportButton).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await exportButton.click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const markdown = await readFile(downloadPath, 'utf8');

    expect(markdown).toContain('Filters: Broker: All brokers; Type: All types; Currency: All currencies; Description: All descriptions; Equity range: Max');
    expect(markdown).toContain('| Broker | No. | Time | Type | Description | Currency | Amount | Commission | Market value | Cash | Equity |');
    expect(markdown).toContain('| IBKR | 1 |');
});

test('keeps a Stock details Markdown export range aligned with its transaction-date filter', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {ledger_no: 1, broker: 'ibkr', date: '2026-07-21', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 500, amount: -500},
            {ledger_no: 2, broker: 'ibkr', date: '2026-07-22', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 505, amount: -505},
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-07-21', close: 500},
                {date: '2026-07-22', close: 505},
            ],
        },
    });
    await page.goto('/trade/investment?ticker=QQQ#stock_panel');

    await expect(page.locator('#investment_stock_details_table_host')).toBeVisible();
    await page.locator('[data-investment-stock-details-time-filter-trigger]').click();
    const dateInput = page.locator('#investment_stock_details_date_start');
    await expect(dateInput).toHaveCount(1);
    await dateInput.evaluate((input) => {
        input.value = '2026-07-22';
        input.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await expect(page.locator('[data-investment-stock-detail-ledger="1"]')).toHaveCount(0);
    await expect(page.locator('[data-investment-stock-detail-ledger="2"]')).toHaveCount(1);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export_transactions_button').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const markdown = await readFile(downloadPath, 'utf8');

    expect(markdown).toContain('**Range:** 22 Jul 2026 - 22 Jul 2026');
    expect(markdown).toContain('Filters: Broker: All brokers; Type: All types; Currency: All currencies; Description: All descriptions; Transaction date: 22 Jul 2026');
    expect(markdown).toContain('| IBKR | 2 |');
    expect(markdown).not.toContain('| IBKR | 1 |');
});

test('matches Stock details numeric typography to Transaction history', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {ledger_no: 1, broker: 'ibkr', date: '2026-07-21', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 500.25, amount: -500.25, commission: -1.25},
            {ledger_no: 2, broker: 'ibkr', date: '2026-07-22', type: 'sell', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 510.75, amount: 510.75, commission: -1.75, broker_realized_pnl_raw: 10.50},
            {ledger_no: 3, broker: 'ibkr', date: '2026-07-23', type: 'sell', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 490.00, amount: 490.00, commission: -1.50, broker_realized_pnl_raw: -10.50},
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-07-21', close: 500.25},
                {date: '2026-07-22', close: 510.75},
                {date: '2026-07-23', close: 490.00},
            ],
        },
    });
    await page.goto('/trade/investment?ticker=QQQ#stock_panel');

    const typographyPairs = await page.locator('[data-investment-stock-detail-ledger="2"]').evaluate((stockRow) => {
        const stockBuyRow = document.querySelector('[data-investment-stock-detail-ledger="1"]');
        const historyBuyRow = document.querySelector('#investment_history_row_1');
        const historyRow = document.querySelector('#investment_history_row_2');
        const readCell = (cell) => {
            const metric = cell?.querySelector('.investment-history-metric-value.trade-metric-value');
            const major = cell?.querySelector('.workspace-metric-value-major');
            const minor = cell?.querySelector('.workspace-metric-value-minor');
            return {
                hasMetric: Boolean(metric),
                hasMajor: Boolean(major),
                majorFontSize: major ? getComputedStyle(major).fontSize : '',
                minorFontSize: minor ? getComputedStyle(minor).fontSize : '',
            };
        };
        return [
            [stockBuyRow, 6, historyBuyRow, 6],
            [stockBuyRow, 7, historyBuyRow, 7],
            [stockBuyRow, 8, historyBuyRow, 8],
            [stockRow, 9, historyRow, 10],
        ].map(([stock, stockIndex, history, historyIndex]) => ({
            stock: readCell(stock?.cells.item(stockIndex)),
            history: readCell(history?.cells.item(historyIndex)),
        }));
    });

    for (const pair of typographyPairs) {
        expect(pair.stock.hasMetric).toBe(true);
        expect(pair.stock.hasMajor).toBe(true);
        expect(pair.stock.majorFontSize).toBe(pair.history.majorFontSize);
        expect(pair.stock.minorFontSize).toBe(pair.history.minorFontSize);
    }

    const colorTones = await page.evaluate(() => {
        const resolveTokenColor = (tokenName) => {
            const probe = document.createElement('span');
            probe.style.color = `var(${tokenName})`;
            document.body.appendChild(probe);
            const color = getComputedStyle(probe).color;
            probe.remove();
            return color;
        };
        const readPnlTone = (ledgerNo) => {
            const cell = document.querySelector(`[data-investment-stock-detail-ledger="${ledgerNo}"]`)?.cells.item(9);
            const metric = cell?.querySelector('.investment-history-metric-value');
            return {
                className: metric?.className || '',
                color: metric ? getComputedStyle(metric).color : '',
                expectedColor: resolveTokenColor(
                    ledgerNo === '2' ? '--theme-accent-positive' : '--theme-accent-secondary',
                ),
            };
        };
        return {
            positive: readPnlTone('2'),
            negative: readPnlTone('3'),
        };
    });

    expect(colorTones.positive.className).toContain('investment-holdings-value-positive');
    expect(colorTones.positive.color).toBe(colorTones.positive.expectedColor);
    expect(colorTones.negative.className).toContain('investment-holdings-value-negative');
    expect(colorTones.negative.color).toBe(colorTones.negative.expectedColor);
});

test('exports the filtered Stock details scope as a standard XLSX workbook', async ({page}) => {
    const standardWorkbook = await readFile(fixturePath('zircon-hk-valid.xlsx'));
    let exportRequest = null;
    await page.route('**/api/investment/exports/standard.xlsx', async (route) => {
        exportRequest = route.request().postDataJSON();
        await route.fulfill({
            status: 200,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            headers: {
                'Content-Disposition': 'attachment; filename=QQQ_standard_investment_export.xlsx',
            },
            body: standardWorkbook,
        });
    });
    await mockInvestmentReadApis(page, {
        transactions: [
            {ledger_no: 1, broker: 'ibkr', date: '2026-07-21', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 500, amount: -500},
            {ledger_no: 2, broker: 'ibkr', date: '2026-07-22', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 505, amount: -505},
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-07-21', close: 500},
                {date: '2026-07-22', close: 505},
            ],
        },
    });
    await page.goto('/trade/investment?ticker=QQQ#stock_panel');

    await page.locator('[data-investment-stock-details-time-filter-trigger]').click();
    await page.locator('#investment_stock_details_date_start').evaluate((input) => {
        input.value = '2026-07-22';
        input.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await page.locator('#investment_share_actions > .export-transactions-button').hover();
    const standardXlsxButton = page.locator('#export_standard_xlsx_button');
    const standardXlsxButtonBox = await standardXlsxButton.boundingBox();
    expect(standardXlsxButtonBox).not.toBeNull();
    await page.mouse.move(
        standardXlsxButtonBox.x + (standardXlsxButtonBox.width / 2),
        standardXlsxButtonBox.y + (standardXlsxButtonBox.height / 2),
        {steps: 12},
    );
    await expect(standardXlsxButton).toHaveCSS('pointer-events', 'auto');
    const downloadPromise = page.waitForEvent('download');
    await standardXlsxButton.click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(download.suggestedFilename()).toBe('QQQ_standard_investment_export.xlsx');
    expect(downloadPath).not.toBeNull();
    const downloadedBytes = await readFile(downloadPath);
    expect(downloadedBytes.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(exportRequest.transactions).toHaveLength(1);
    expect(exportRequest.transactions[0].ledger_no).toBe(2);
});

test('uses Longbridge extended-hours quotes for the Stock details live position without animating metric-card chrome', async ({page}) => {
    await page.addInitScript(() => {
        const RealDate = Date;
        const fixedTimestamp = new RealDate('2026-07-20T21:30:00Z').valueOf();
        class FixedDate extends RealDate {
            constructor(...args) {
                super(...(args.length ? args : [fixedTimestamp]));
            }

            static now() {
                return fixedTimestamp;
            }
        }
        window.Date = FixedDate;

        const nativeSetTimeout = window.setTimeout.bind(window);
        window.setTimeout = (callback, delay, ...args) => {
            if (delay === 60_000 && typeof callback === 'function') {
                window.__testTriggerInvestmentRealtimePoll = () => callback(...args);
                return 0;
            }
            return nativeSetTimeout(callback, delay, ...args);
        };
    });
    let quoteSource = 'longbridge';
    let quotePrice = 55.54;
    const liveQuotes = () => [{
        ticker: 'DRAM',
        price: quotePrice,
        timestamp: '2026-07-20 17:30',
        session: 'post',
        session_date: '2026-07-20',
        market: 'US',
        source: quoteSource,
    }];
    await mockInvestmentReadApis(page, {
        transactions: [
            {ledger_no: 1, broker: 'ibkr', date: '2026-07-20', type: 'buy', ticker: 'DRAM', currency: 'USD', quantity: 10, price: 54, amount: -540},
        ],
        priceHistoryByTicker: {
            DRAM: [
                {date: '2026-07-16', close: 53.0},
                {date: '2026-07-17', close: 54.0},
                {date: '2026-07-20', close: 55.0},
            ],
        },
        realtimeQuotes: liveQuotes,
        marketSession: {
            session: 'post',
            is_trading_day: true,
            is_realtime_allowed: true,
            session_date: '2026-07-20',
        },
    });
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.setViewportSize({width: 1_024, height: 863});
    const firstSessionResponse = page.waitForResponse((response) => (
        response.url().includes('/api/market-session/us-equity')
    ));
    const firstRealtimeQuoteResponse = page.waitForResponse((response) => (
        response.url().includes('/api/investment/realtime-quotes')
    ));
    await page.goto('/trade/investment?ticker=DRAM#stock_panel');
    await firstSessionResponse;
    await firstRealtimeQuoteResponse;
    await page.locator('label[for="investment_stock_details_range_3m"]').click();

    const marker = page.locator('[data-investment-stock-details-live-marker]');
    await expect.poll(() => marker.evaluate((element) => !element.hidden)).toBe(true);
    const metricGrid = page.locator('.investment-stock-details-metrics');
    await expect(metricGrid).not.toHaveClass(/is-investment-realtime-pulse/);
    await expect(metricGrid.locator('.investment-stock-details-metric-card').first()).toHaveCSS('animation-name', 'none');
    const longbridgeGeometry = await marker.evaluate((element) => {
        const canvas = document.querySelector('.investment-stock-details-price-chart-canvas');
        const chart = window.Chart.getChart(canvas);
        const lastIndex = chart.data.labels.length - 1;
        return {
            markerLeft: Number.parseFloat(element.style.left),
            markerTop: Number.parseFloat(element.style.top),
            expectedLeft: chart.scales.x.getPixelForValue(lastIndex),
            expectedTop: chart.scales.y.getPixelForValue(55.54),
            yMaximum: chart.scales.y.max,
        };
    });
    expect(Math.abs(longbridgeGeometry.markerLeft - longbridgeGeometry.expectedLeft)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(longbridgeGeometry.markerTop - longbridgeGeometry.expectedTop)).toBeLessThanOrEqual(0.5);
    expect(longbridgeGeometry.yMaximum).toBeGreaterThanOrEqual(55.54);

    const lastPrice = metricGrid.locator('[data-investment-live-field="stock_last_price"]');
    const holdingsLastPrice = page.locator(
        '#investment_holdings_panel tr[data-investment-holdings-ticker="DRAM"] [data-investment-live-field="last"]',
    ).first();
    await expect(lastPrice).toHaveAttribute('data-investment-live-number', '55.54');
    await expect(lastPrice).toHaveAttribute('data-investment-live-display', '55.54');
    await expect(lastPrice).not.toHaveAttribute('data-investment-live-animation-token', /.+/);
    await expect.poll(() => page.evaluate(() => (
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ))).toBe(false);
    const freezeLiveDigitAnimations = () => page.evaluate(() => {
        const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
        window.__testNativeInvestmentRequestAnimationFrame = nativeRequestAnimationFrame;
        window.__testPendingInvestmentAnimationFrames = [];
        window.requestAnimationFrame = (callback) => {
            window.__testPendingInvestmentAnimationFrames.push(callback);
            return window.__testPendingInvestmentAnimationFrames.length;
        };
    });
    const resumeLiveDigitAnimations = () => page.evaluate(() => {
        const nativeRequestAnimationFrame = window.__testNativeInvestmentRequestAnimationFrame;
        const pendingFrames = window.__testPendingInvestmentAnimationFrames || [];
        if (typeof nativeRequestAnimationFrame === 'function') {
            window.requestAnimationFrame = nativeRequestAnimationFrame;
            pendingFrames.forEach((callback) => nativeRequestAnimationFrame(callback));
        }
        delete window.__testNativeInvestmentRequestAnimationFrame;
        delete window.__testPendingInvestmentAnimationFrames;
    });
    await expect.poll(() => page.evaluate(() => typeof window.__testTriggerInvestmentRealtimePoll)).toBe('function');
    quotePrice = 56.54;
    await freezeLiveDigitAnimations();
    const risingQuoteResponse = page.waitForResponse((response) => (
        response.url().includes('/api/investment/realtime-quotes')
    ));
    await page.evaluate(() => window.__testTriggerInvestmentRealtimePoll());
    await risingQuoteResponse;
    await expect(lastPrice).toHaveClass(/is-live-rise/);
    await expect(lastPrice.locator('.investment-live-digit--rise .investment-live-digit-face--new').first())
        .toHaveCSS('color', 'rgb(22, 163, 74)');
    await expect(holdingsLastPrice).toHaveAttribute('data-investment-live-number', '56.54');
    await expect(holdingsLastPrice).not.toHaveClass(/is-live-rise/);
    await expect(holdingsLastPrice.locator('.investment-live-digit')).toHaveCount(0);
    await expect(metricGrid.locator('.investment-stock-details-metric-card').first()).toHaveCSS('animation-name', 'none');
    await resumeLiveDigitAnimations();
    await expect(lastPrice).not.toHaveClass(/is-live-rise/);

    quotePrice = 54.54;
    await freezeLiveDigitAnimations();
    const fallingQuoteResponse = page.waitForResponse((response) => (
        response.url().includes('/api/investment/realtime-quotes')
    ));
    await page.evaluate(() => window.__testTriggerInvestmentRealtimePoll());
    await fallingQuoteResponse;
    await expect(lastPrice).toHaveClass(/is-live-fall/);
    await expect(lastPrice.locator('.investment-live-digit--fall .investment-live-digit-face--new').first())
        .toHaveCSS('color', 'rgb(255, 47, 146)');
    await expect(holdingsLastPrice).toHaveAttribute('data-investment-live-number', '54.54');
    await expect(holdingsLastPrice).not.toHaveClass(/is-live-fall/);
    await expect(holdingsLastPrice.locator('.investment-live-digit')).toHaveCount(0);
    await resumeLiveDigitAnimations();
    await expect(lastPrice).not.toHaveClass(/is-live-fall/);

    quoteSource = 'yfinance';
    const secondSessionResponse = page.waitForResponse((response) => (
        response.url().includes('/api/market-session/us-equity')
    ));
    await page.reload();
    await secondSessionResponse;
    await page.locator('label[for="investment_stock_details_range_3m"]').click();
    await expect.poll(() => marker.evaluate((element) => element.hidden)).toBe(true);
    await expect(metricGrid).not.toHaveClass(/is-investment-realtime-pulse/);
});

test('matches every dark investment transaction header to body text without changing light mode', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {ledger_no: 1, broker: 'ibkr', date: '2026-07-10', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 500, amount: -500},
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-07-10', close: 500},
                {date: '2026-07-11', close: 501},
            ],
        },
    });
    await page.emulateMedia({colorScheme: 'dark'});
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment?ticker=QQQ#stock_panel');

    const stockTable = page.locator('#investment_stock_details_table_host');
    const historyTable = page.locator('#history_table_wrap');
    await expect(stockTable).toBeVisible();
    await expect(historyTable).toBeHidden();
    const readColors = (table) => table.evaluate((host) => {
        const bodyCell = host.querySelector('tbody td');
        const headers = Array.from(host.querySelectorAll('thead th'));
        return {
            body: getComputedStyle(bodyCell).color,
            headers: headers.map((header) => ({
                color: getComputedStyle(header).color,
                label: header.getAttribute('aria-label') || header.textContent.trim(),
            })),
            filterControls: headers
                .flatMap((header) => Array.from(header.querySelectorAll('button')))
                .map((control) => getComputedStyle(control).color),
        };
    });

    const darkStockColors = await readColors(stockTable);
    expect(darkStockColors.headers.map(({label}) => label)).toContain('Realized P&L');
    expect(darkStockColors.headers.every(({color}) => color === darkStockColors.body)).toBe(true);
    expect(darkStockColors.filterControls.every((color) => color === darkStockColors.body)).toBe(true);

    await page.emulateMedia({colorScheme: 'light'});
    await expect.poll(async () => (await readColors(stockTable)).headers[0].color).not.toBe(darkStockColors.body);
    const lightStockColors = await readColors(stockTable);
    expect(lightStockColors.headers.every(({color}) => color !== lightStockColors.body)).toBe(true);
    expect(lightStockColors.headers.every(({color}) => color !== darkStockColors.body)).toBe(true);
    expect(lightStockColors.filterControls.every((color) => color !== darkStockColors.body)).toBe(true);
});

test('sizes the stock-detail Type menu to its widest option', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {ledger_no: 1, broker: 'ibkr', date: '2026-07-10', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 500, amount: -500},
            {ledger_no: 2, broker: 'ibkr', date: '2026-07-11', type: 'foreign_tax_withholding', ticker: 'QQQ', currency: 'USD', amount: -1},
            {ledger_no: 3, broker: 'ibkr', date: '2026-07-12', type: 'forex_trade_component', ticker: 'QQQ', currency: 'USD', amount: 2},
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-07-10', close: 500},
                {date: '2026-07-11', close: 501},
                {date: '2026-07-12', close: 502},
            ],
        },
    });
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment?ticker=QQQ#stock_panel');

    const stockTable = page.locator('#investment_stock_details_table_host');
    const trigger = stockTable.locator('[data-investment-side-filter-trigger]');
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dropdown = page.locator(
        '[data-investment-side-filter-dropdown][data-filter-owner="investment_stock_details_side_filter"]',
    );
    await expect(dropdown).toBeVisible();
    const geometry = await dropdown.evaluate((menu) => {
        const triggerElement = document.querySelector(
            '#investment_stock_details_table_host [data-investment-side-filter-trigger]',
        );
        const titles = Array.from(menu.querySelectorAll('.trade-strategy-dropdown-title'));
        return {
            clippedTitles: titles
                .filter((title) => title.scrollWidth > title.clientWidth + 1)
                .map((title) => title.textContent),
            menuWidth: menu.getBoundingClientRect().width,
            triggerWidth: triggerElement?.getBoundingClientRect().width || 0,
        };
    });
    expect(geometry.clippedTitles).toEqual([]);
    expect(geometry.menuWidth).toBeGreaterThan(geometry.triggerWidth);
});

test('keeps stock-detail metric sources collapsed until their shared arrow is toggled', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['ibkr', 'hsbc'],
        transactions: [
            {broker: 'ibkr', date: '2026-07-10', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 2, price: 100, amount: -200, commission: 0.20},
            {broker: 'hsbc', date: '2026-07-11', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 2, price: 101, amount: -202, commission: 0.20},
            {broker: 'ibkr', date: '2026-07-12', type: 'sell', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 110, amount: 110, commission: 0.10},
            {broker: 'ibkr', date: '2026-07-13', type: 'dividend', ticker: 'QQQ', currency: 'USD', amount: 10},
            {broker: 'ibkr', date: '2026-07-14', type: 'foreign_tax_withholding', ticker: 'QQQ', currency: 'USD', amount: -1},
            {broker: 'hsbc', date: '2026-07-15', type: 'sell', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 111, amount: 111, commission: 0.10},
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-07-10', close: 100},
                {date: '2026-07-11', close: 101},
                {date: '2026-07-12', close: 110},
                {date: '2026-07-13', close: 109},
                {date: '2026-07-14', close: 110},
                {date: '2026-07-15', close: 112},
            ],
        },
    });
    await page.setViewportSize({width: 735, height: 686});
    await page.goto('/trade/investment?ticker=QQQ#stock_panel');
    await setSidebarExpanded(page, false);
    await expect(page.locator('#stock_panel .investment-stock-details-price-chart-canvas')).toBeVisible();

    const portfolioWeightValue = page.locator('#stock_panel .trade-metric-card')
        .filter({hasText: 'Portfolio weight'})
        .locator('.investment-stock-details-metric-value');
    await expect(portfolioWeightValue.locator('.workspace-metric-value-major')).toHaveText(/^\d+$/);
    await expect(portfolioWeightValue.locator('.workspace-metric-value-minor')).toHaveText(/^\.\d+$/);
    const fractionalTypography = await portfolioWeightValue.evaluate((value) => {
        const major = value.querySelector('.workspace-metric-value-major');
        const minor = value.querySelector('.workspace-metric-value-minor');
        if (!(major instanceof HTMLElement) || !(minor instanceof HTMLElement)) return null;
        const majorStyle = getComputedStyle(major);
        const minorStyle = getComputedStyle(minor);
        const majorTextRange = document.createRange();
        majorTextRange.selectNodeContents(major);
        const minorTextRange = document.createRange();
        minorTextRange.selectNodeContents(minor);
        return {
            majorFontSize: Number.parseFloat(majorStyle.fontSize),
            minorFontSize: Number.parseFloat(minorStyle.fontSize),
            minorTransform: minorStyle.transform,
            textBottomDelta: Math.abs(
                majorTextRange.getBoundingClientRect().bottom
                - minorTextRange.getBoundingClientRect().bottom
            ),
        };
    });
    expect(fractionalTypography).not.toBeNull();
    expect(fractionalTypography.minorFontSize).toBeLessThan(fractionalTypography.majorFontSize);
    expect(fractionalTypography.minorTransform).not.toBe('none');
    expect(fractionalTypography.textBottomDelta).toBeLessThanOrEqual(0.1);

    const detailCards = page.locator('#stock_panel .investment-stock-details-metric-card-with-breakdown');
    await expect(detailCards).toHaveCount(5);
    await expect(detailCards.locator('.investment-stock-details-metric-breakdown')).toHaveCount(5);
    await expect(detailCards.locator('.investment-stock-details-metric-breakdown:not([hidden])')).toHaveCount(0);
    await expect(detailCards.locator('.investment-stock-details-metric-breakdown-trigger[aria-expanded="false"]')).toHaveCount(5);

    const alignment = await detailCards.evaluateAll((cards) => cards.map((card) => {
        const row = card.querySelector('.investment-stock-details-metric-value-row');
        const trigger = card.querySelector('.investment-stock-details-metric-breakdown-trigger');
        const value = card.querySelector('.investment-stock-details-metric-value');
        if (!(row instanceof HTMLElement) || !(trigger instanceof HTMLElement) || !(value instanceof HTMLElement)) return null;
        const rowRect = row.getBoundingClientRect();
        const triggerRect = trigger.getBoundingClientRect();
        const valueRect = value.getBoundingClientRect();
        return {
            triggerLeftDelta: triggerRect.left - rowRect.left,
            triggerCenterDelta: (triggerRect.top + (triggerRect.height / 2)) - (valueRect.top + (valueRect.height / 2)),
            triggerWidth: triggerRect.width,
            triggerHeight: triggerRect.height,
        };
    }));
    expect(alignment.every(Boolean)).toBe(true);
    alignment.forEach((entry) => {
        expect(Math.abs(entry.triggerLeftDelta)).toBeLessThanOrEqual(1);
        expect(Math.abs(entry.triggerCenterDelta)).toBeLessThanOrEqual(1);
        expect(entry.triggerWidth).toBe(20);
        expect(entry.triggerHeight).toBe(20);
    });

    const brokerTrigger = page.locator('#investment_stock_details_table_host [data-investment-broker-filter-trigger]');
    const firstDetailCard = detailCards.first();
    const metricTrigger = firstDetailCard.locator('.investment-stock-details-metric-breakdown-trigger');
    await expect(brokerTrigger).toBeVisible();
    const readMetricTriggerPresentation = () => metricTrigger.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            opacity: style.opacity,
            pointerEvents: style.pointerEvents,
        };
    });
    expect(await readMetricTriggerPresentation()).toEqual({opacity: '0', pointerEvents: 'none'});
    await firstDetailCard.hover();
    await expect.poll(readMetricTriggerPresentation).toEqual({opacity: '1', pointerEvents: 'auto'});
    await page.locator('#investment_view_segmented').hover();
    await expect.poll(readMetricTriggerPresentation).toEqual({opacity: '0', pointerEvents: 'none'});
    await metricTrigger.focus();
    await expect.poll(readMetricTriggerPresentation).toEqual({opacity: '1', pointerEvents: 'auto'});

    const sharedArrowGeometry = async (locator) => locator.evaluate((element) => {
        const triggerStyle = getComputedStyle(element);
        const arrowStyle = getComputedStyle(element, '::before');
        return {
            triggerWidth: triggerStyle.width,
            triggerHeight: triggerStyle.height,
            arrowWidth: arrowStyle.width,
            arrowHeight: arrowStyle.height,
            arrowMask: arrowStyle.maskImage || arrowStyle.webkitMaskImage,
        };
    });
    expect(await sharedArrowGeometry(metricTrigger)).toEqual(await sharedArrowGeometry(brokerTrigger));

    const realizedCard = detailCards.filter({has: page.locator('.trade-metric-label', {hasText: /^Realized P&L$/})});
    const realizedTrigger = realizedCard.locator('.investment-stock-details-metric-breakdown-trigger');
    const realizedBreakdown = realizedCard.locator('.investment-stock-details-metric-breakdown');
    const readRealizedTriggerAlignment = () => realizedTrigger.evaluate((trigger) => {
        const value = trigger.parentElement?.querySelector('.investment-stock-details-metric-value');
        if (!(value instanceof HTMLElement)) return null;
        const triggerRect = trigger.getBoundingClientRect();
        const valueRect = value.getBoundingClientRect();
        return {
            centerDelta: (triggerRect.top + (triggerRect.height / 2))
                - (valueRect.top + (valueRect.height / 2)),
            transform: getComputedStyle(trigger).transform,
        };
    });
    const realizedAlignmentBeforeInteraction = await readRealizedTriggerAlignment();
    expect(realizedAlignmentBeforeInteraction).not.toBeNull();
    await realizedCard.hover();
    await expect.poll(readRealizedTriggerAlignment).toEqual(realizedAlignmentBeforeInteraction);
    await expect(realizedBreakdown).toBeHidden();
    await realizedTrigger.click();
    await expect(realizedTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(readRealizedTriggerAlignment).toEqual(realizedAlignmentBeforeInteraction);
    await expect(realizedTrigger).toHaveAttribute('aria-label', 'Hide Realized P&L details');
    await expect(realizedBreakdown).toBeVisible();
    await expect(realizedBreakdown).toContainText('Dividend income');
    await expect(realizedBreakdown).toContainText('Foreign tax withholding');
    await expect(realizedBreakdown).toContainText('Trading spread income');
    await expect(realizedBreakdown).toContainText('IBKR · Dividend income');
    await expect(realizedBreakdown).toContainText('IBKR · Foreign tax withholding');
    await expect(realizedBreakdown).toContainText('IBKR · Trading spread income');
    await expect(realizedBreakdown).toContainText('HSBC · Trading spread income');

    const marketValueCard = detailCards.filter({has: page.locator('.trade-metric-label', {hasText: /^Market value$/})});
    const marketValueTrigger = marketValueCard.locator('.investment-stock-details-metric-breakdown-trigger');
    await marketValueTrigger.focus();
    await marketValueTrigger.press('Enter');
    await expect(marketValueTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(marketValueCard.locator('.investment-stock-details-metric-breakdown')).toBeVisible();
    await expect(realizedBreakdown).toBeVisible();

    await realizedTrigger.focus();
    await realizedTrigger.press('Space');
    await expect(realizedTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(realizedTrigger).toHaveAttribute('aria-label', 'Show Realized P&L details');
    await expect(realizedBreakdown).toBeHidden();
    await expect(page.locator('#stock_panel .investment-stock-details-metric-card', {
        has: page.locator('.trade-metric-label', {hasText: /^Unrealized P&L$/}),
    }).locator('.investment-stock-details-metric-breakdown-trigger')).toHaveCount(0);
});

test('keeps YTD investment x-axis labels inside the overview clip at low desktop heights', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-01-02', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 500, amount: -500},
            {broker: 'ibkr', date: '2026-03-09', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 501, amount: -501},
            {broker: 'ibkr', date: '2026-05-15', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 502, amount: -502},
            {broker: 'ibkr', date: '2026-07-17', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 503, amount: -503},
        ],
    });
    await page.setViewportSize({width: 792, height: 675});
    await page.goto('/trade/investment');
    await setSidebarExpanded(page, false);
    await expect.poll(() => page.locator(
        '.investment-workspace-header > .workspace-summary-card'
    ).evaluate((card) => {
        const rootStyles = getComputedStyle(document.documentElement);
        const expected = Number.parseFloat(
            rootStyles.getPropertyValue('--workspace-title-rail-pad-block-start')
        );
        const actual = Number.parseFloat(getComputedStyle(card).paddingTop);
        return Math.abs(actual - expected);
    })).toBeLessThanOrEqual(0.5);
    await page.locator('label[for="investment_equity_range_ytd"]').click();
    await expect(page.locator('#investmentEquityChart[data-investment-chart-ready="1"]')).toBeVisible();
    const resizer = page.locator('#investment_section_resizer');
    await resizer.focus();
    await resizer.press('Home');
    await expect.poll(() => page.locator('#investmentEquityChart').evaluate((canvas) => {
        const clip = document.querySelector('.investment-view-surface-body');
        return canvas.getBoundingClientRect().bottom <= clip.getBoundingClientRect().bottom + 1;
    })).toBe(true);

    const geometry = await page.evaluate(() => {
        const canvas = document.querySelector('#investmentEquityChart');
        const clip = document.querySelector('.investment-view-surface-body');
        const history = document.querySelector('#investment_history_surface');
        const chart = window.Chart?.getChart?.(canvas);
        if (!(canvas instanceof HTMLCanvasElement) || !clip || !history || !chart?.chartArea) return null;
        const canvasRect = canvas.getBoundingClientRect();
        const clipRect = clip.getBoundingClientRect();
        const historyRect = history.getBoundingClientRect();
        const labelOptions = chart.options?.plugins?.investmentXAxisLabels || {};
        const fontSize = Number.parseFloat(labelOptions.fontSize) || 12;
        const lineHeight = Number.parseFloat(labelOptions.lineHeight) || 10;
        return {
            axisLabelBottom: canvasRect.top + chart.chartArea.bottom + lineHeight + fontSize,
            canvasBottom: canvasRect.bottom,
            clipBottom: clipRect.bottom,
            historyTop: historyRect.top,
        };
    });
    expect(geometry).not.toBeNull();
    expect(geometry.axisLabelBottom).toBeLessThanOrEqual(geometry.clipBottom + 1);
    expect(geometry.canvasBottom).toBeLessThanOrEqual(geometry.clipBottom + 1);
    expect(geometry.clipBottom).toBeLessThanOrEqual(geometry.historyTop + 1);
});

test('aligns the trade title with the shared desktop title rail', async ({page}) => {
    await mockInvestmentReadApis(page);
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/trade/investment');

    const readTitleGeometry = () => page.evaluate(() => {
        const trade = document.querySelector('#app_sidebar .hero h1').getBoundingClientRect();
        const investment = document.querySelector(
            '.investment-workspace-header > .workspace-summary-card .report-heading'
        ).getBoundingClientRect();
        const summary = document.querySelector(
            '.investment-workspace-header > .workspace-summary-card'
        ).getBoundingClientRect();
        const toggle = document.querySelector('#sidebar_toggle').getBoundingClientRect();
        const theme = document.querySelector('#global_theme_toggle').getBoundingClientRect();
        const centerY = (rect) => rect.top + (rect.height / 2);
        return {
            tradeCenter: centerY(trade),
            investmentCenter: centerY(investment),
            summaryHeight: summary.height,
            toggleCenter: centerY(toggle),
            toggleRight: toggle.right,
            themeCenter: centerY(theme),
            investmentLeft: investment.left,
        };
    });

    await expect(page.locator('#sidebar_toggle')).toHaveAttribute('aria-expanded', 'true');
    const expanded = await readTitleGeometry();
    expect(Math.abs(expanded.tradeCenter - expanded.investmentCenter)).toBeLessThanOrEqual(1);
    expect(Math.abs(expanded.investmentCenter - expanded.toggleCenter)).toBeLessThanOrEqual(1);
    expect(Math.abs(expanded.investmentCenter - expanded.themeCenter)).toBeLessThanOrEqual(1);

    await page.locator('#sidebar_toggle').click();
    await expect(page.locator('#sidebar_toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(async () => {
        const collapsed = await readTitleGeometry();
        return collapsed.investmentLeft - collapsed.toggleRight;
    }).toBeGreaterThanOrEqual(12);
    const collapsed = await readTitleGeometry();
    expect(Math.abs(collapsed.investmentCenter - collapsed.toggleCenter)).toBeLessThanOrEqual(1);
    expect(Math.abs(collapsed.investmentCenter - collapsed.themeCenter)).toBeLessThanOrEqual(1);
    expect(Math.abs(collapsed.summaryHeight - expanded.summaryHeight)).toBeLessThanOrEqual(1);

    await page.locator('#sidebar_toggle').click();
    await expect(page.locator('#sidebar_toggle')).toHaveAttribute('aria-expanded', 'true');
    const unlockResponse = await page.context().request.post('/trade/live-trading/unlock', {
        form: {pin: process.env.ANTIGRAVITY_LIVE_TRADING_PIN || '123456'},
    });
    expect(unlockResponse.status()).toBe(200);
    await page.goto('/trade/live-trading');
    await expect(page.locator(
        '.investment-workspace-header > .workspace-summary-card .report-heading'
    )).toHaveText('Live trading');
    const liveTrading = await readTitleGeometry();
    expect(Math.abs(liveTrading.tradeCenter - liveTrading.investmentCenter)).toBeLessThanOrEqual(1);
    expect(Math.abs(liveTrading.investmentCenter - liveTrading.toggleCenter)).toBeLessThanOrEqual(1);
    expect(Math.abs(liveTrading.investmentCenter - liveTrading.themeCenter)).toBeLessThanOrEqual(1);
});

test('keeps shared desktop titles clear throughout sidebar motion', async ({page}) => {
    await mockInvestmentReadApis(page);
    await page.setViewportSize({width: 1024, height: 863});

    const routes = [
        {
            url: '/trade/investment',
            title: '.investment-workspace-header > .workspace-summary-card .report-heading',
        },
        {
            url: '/workspaces/compare?ticker=QQQ&ticker=AAPL&period=1y',
            title: '.workspace-mode-title-card .report-heading',
        },
        {
            url: '/settings/about',
            title: '.settings-workspace-header > .settings-summary-card .report-heading',
        },
    ];

    const sampleTransition = (titleSelector) => page.evaluate(async (selector) => {
        const toggle = document.querySelector('#sidebar_toggle');
        const sidebar = document.querySelector('#app_sidebar');
        const title = document.querySelector(selector);
        if (!(toggle instanceof HTMLElement) || !(sidebar instanceof HTMLElement) || !(title instanceof HTMLElement)) {
            return null;
        }

        const frames = [];
        const startedAt = performance.now();
        toggle.click();
        await new Promise((resolve) => {
            const sample = () => {
                const toggleRect = toggle.getBoundingClientRect();
                const sidebarRect = sidebar.getBoundingClientRect();
                const titleRect = title.getBoundingClientRect();
                frames.push({
                    toggleGap: titleRect.left - toggleRect.right,
                    sidebarGap: titleRect.left - sidebarRect.right,
                });
                if (performance.now() - startedAt >= 700) {
                    resolve();
                    return;
                }
                requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
        });

        return {
            minToggleGap: Math.min(...frames.map((frame) => frame.toggleGap)),
            minSidebarGap: Math.min(...frames.map((frame) => frame.sidebarGap)),
        };
    }, titleSelector);

    for (const route of routes) {
        await page.goto(route.url);
        await expect(page.locator(route.title)).toBeVisible();
        const toggle = page.locator('#sidebar_toggle');
        if (await toggle.getAttribute('aria-expanded') === 'false') {
            await toggle.click();
            await page.waitForTimeout(700);
        }

        const collapse = await sampleTransition(route.title);
        expect(collapse).not.toBeNull();
        expect(collapse.minToggleGap).toBeGreaterThanOrEqual(11.5);
        expect(collapse.minSidebarGap).toBeGreaterThanOrEqual(0);

        const expand = await sampleTransition(route.title);
        expect(expand).not.toBeNull();
        expect(expand.minToggleGap).toBeGreaterThanOrEqual(11.5);
        expect(expand.minSidebarGap).toBeGreaterThanOrEqual(0);
    }
});

test('keeps the selected segmented pill shadow inside the outer edge', async ({page}) => {
    await mockInvestmentReadApis(page);
    await page.setViewportSize({width: 825, height: 900});
    await page.goto('/trade/investment');

    const segmented = page.locator('#investment_view_segmented');
    await expect(segmented.locator('input[value="chart"]')).toBeChecked();
    await expect.poll(() => segmented.evaluate((element) => (
        getComputedStyle(element, '::before').boxShadow
    ))).toContain('12px 12px 24px -12px');

    await page.locator('label[for="investment_view_holdings"]').click();
    await expect(segmented.locator('input[value="holdings"]')).toBeChecked();
    await expect.poll(() => segmented.evaluate((element) => (
        getComputedStyle(element, '::before').boxShadow
    ))).not.toContain('12px 12px 24px -12px');
});

test('keeps Investment segmented effects un-clipped with concentric edge caps', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-07-10', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 500, amount: -500},
            {broker: 'ibkr', date: '2026-07-11', type: 'sell', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 501, amount: 501},
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-07-10', close: 500},
                {date: '2026-07-11', close: 501},
            ],
        },
    });
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment?ticker=QQQ');

    const segmented = page.locator('#investment_view_segmented');
    const readCapDelta = (side) => segmented.evaluate((element, requestedSide) => {
        const railRect = element.getBoundingClientRect();
        const thumbStyles = getComputedStyle(element, '::before');
        const matrixParts = (thumbStyles.transform.match(/^matrix\(([^)]+)\)$/)?.[1] || '').split(',');
        const translateX = Number.parseFloat(matrixParts[4]) || 0;
        const thumbLeft = railRect.left
            + (Number.parseFloat(thumbStyles.left) || 0)
            + translateX;
        const thumbWidth = Number.parseFloat(thumbStyles.width) || 0;
        const thumbHeight = railRect.height
            - (Number.parseFloat(thumbStyles.top) || 0)
            - (Number.parseFloat(thumbStyles.bottom) || 0);
        if (requestedSide === 'right') {
            const railCenter = railRect.right - (railRect.height / 2);
            const thumbCenter = thumbLeft + thumbWidth - (thumbHeight / 2);
            return thumbCenter - railCenter;
        }
        const railCenter = railRect.left + (railRect.height / 2);
        const thumbCenter = thumbLeft + (thumbHeight / 2);
        return thumbCenter - railCenter;
    }, side);
    const readLayerGeometry = (controlSelector, stageSelector) => page.evaluate(({controlSelector: controlQuery, stageSelector: stageQuery}) => {
        const control = document.querySelector(controlQuery);
        const shell = control?.closest('.investment-stock-details-range-shell');
        const stage = document.querySelector(stageQuery);
        if (!(control instanceof HTMLElement) || !(shell instanceof HTMLElement) || !(stage instanceof HTMLElement)) return null;
        const controlStyles = getComputedStyle(control);
        const shellStyles = getComputedStyle(shell);
        const stageStyles = getComputedStyle(stage);
        return {
            controlOverflowX: controlStyles.overflowX,
            controlOverflowY: controlStyles.overflowY,
            overflowState: control.dataset.segmentedOverflow,
            shellOverflowX: shellStyles.overflowX,
            shellOverflowY: shellStyles.overflowY,
            shellZIndex: Number.parseFloat(shellStyles.zIndex) || 0,
            stageZIndex: Number.parseFloat(stageStyles.zIndex) || 0,
        };
    }, {controlSelector, stageSelector});

    await expect(segmented).toHaveClass(/is-pill-ready/);
    await expect.poll(() => readCapDelta('left')).toBeCloseTo(0, 5);
    await expect(segmented).toHaveAttribute('data-segmented-overflow', '0');
    await expect.poll(() => segmented.evaluate((element) => getComputedStyle(element).overflowY)).toBe('visible');

    const overviewRange = page.locator('#investment_equity_chart .investment-stock-details-range-segmented');
    await expect(overviewRange).toHaveClass(/is-pill-ready/);
    await expect(overviewRange).toHaveAttribute('data-segmented-overflow', '0');
    const overviewLayers = await readLayerGeometry(
        '#investment_equity_chart .investment-stock-details-range-segmented',
        '#investment_equity_chart .investment-equity-chart-stage',
    );
    expect(overviewLayers).not.toBeNull();
    expect(overviewLayers).toMatchObject({
        controlOverflowX: 'visible',
        controlOverflowY: 'visible',
        overflowState: '0',
        shellOverflowX: 'visible',
        shellOverflowY: 'visible',
    });
    await expect.poll(() => overviewRange.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe('auto');
    expect(overviewLayers.shellZIndex).toBeGreaterThan(overviewLayers.stageZIndex);

    await page.locator('label[for="investment_view_metrics"]').click();
    await expect(segmented).toHaveAttribute('data-active', 'metrics');
    await expect.poll(() => readCapDelta('right')).toBeCloseTo(0, 5);
    await expect(segmented).toHaveAttribute('data-segmented-overflow', '0');

    await page.locator('label[for="investment_view_stock_details"]').click();
    await expect(page.locator('#stock_panel')).toBeVisible();
    const stockDetailsRange = page.locator('#stock_panel .investment-stock-details-range-segmented');
    await expect(stockDetailsRange).toHaveClass(/is-pill-ready/);
    await expect(stockDetailsRange).toHaveAttribute('data-segmented-overflow', '0');
    const segmentedMotherStyle = (selector) => page.locator(selector).evaluate((element) => {
        const computed = getComputedStyle(element);
        const firstOption = element.querySelector('.segmented-control-option');
        return {
            sharedClasses: ['segmented-control', 'segmented-control--compact', 'investment-view-segmented']
                .every((className) => element.classList.contains(className)),
            signature: {
                display: computed.display,
                boxSizing: computed.boxSizing,
                padding: computed.padding,
                gap: computed.gap,
                minHeight: computed.minHeight,
                height: computed.height,
                borderRadius: computed.borderRadius,
                backgroundColor: computed.backgroundColor,
                boxShadow: computed.boxShadow,
                fontSize: computed.fontSize,
                fontWeight: computed.fontWeight,
                lineHeight: computed.lineHeight,
                overflow: computed.overflow,
                pointerEvents: computed.pointerEvents,
            },
            optionShape: firstOption ? {
                tagName: firstOption.tagName,
                className: firstOption.className,
                inputTagName: firstOption.querySelector('input')?.tagName || '',
                labelTagName: firstOption.querySelector('input + span')?.tagName || '',
                nestedLabelCount: firstOption.querySelector('input + span')?.children.length || 0,
            } : null,
        };
    });
    const viewSegmentedMotherStyle = await segmentedMotherStyle('#investment_view_segmented');
    const stockDetailsSegmentedMotherStyle = await segmentedMotherStyle(
        '#stock_panel .investment-stock-details-range-segmented',
    );
    expect(stockDetailsSegmentedMotherStyle.sharedClasses).toBe(true);
    expect(stockDetailsSegmentedMotherStyle.signature).toEqual(viewSegmentedMotherStyle.signature);
    expect(stockDetailsSegmentedMotherStyle.optionShape).toEqual(viewSegmentedMotherStyle.optionShape);
    const stockDetailsLayers = await readLayerGeometry(
        '#stock_panel .investment-stock-details-range-segmented',
        '#stock_panel .investment-stock-details-price-chart-stage',
    );
    expect(stockDetailsLayers).not.toBeNull();
    expect(stockDetailsLayers).toMatchObject({
        controlOverflowX: 'visible',
        controlOverflowY: 'visible',
        overflowState: '0',
        shellOverflowX: 'visible',
        shellOverflowY: 'visible',
    });
    expect(stockDetailsLayers.shellZIndex).toBeGreaterThan(stockDetailsLayers.stageZIndex);
});

test('keeps visible segmented items equal while future items fade through the shared overflow frame', async ({page}) => {
    await mockInvestmentReadApis(page);
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment');

    const segmented = page.locator('#investment_view_segmented');
    const overflowFrame = page.locator('[data-segmented-overflow-frame]:has(#investment_view_segmented)');
    const readOptionWidths = () => segmented.locator('.segmented-control-option').evaluateAll((options) => (
        options.filter((option) => !option.hidden).map((option) => option.getBoundingClientRect().width)
    ));
    const expectEqualWidths = async () => {
        const widths = await readOptionWidths();
        expect(widths.length).toBeGreaterThan(1);
        expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(0.5);
    };

    await expect(segmented).toHaveAttribute('data-segmented-overflow', '0');
    await expect(overflowFrame).toHaveAttribute('data-segmented-overflow', '0');
    await expectEqualWidths();

    await segmented.evaluate((control) => {
        ['Research', 'Income', 'Risk', 'Activity'].forEach((labelText, index) => {
            const label = document.createElement('label');
            const input = document.createElement('input');
            const span = document.createElement('span');
            const optionId = `investment_view_future_${index}`;
            label.className = 'segmented-control-option';
            label.htmlFor = optionId;
            input.id = optionId;
            input.name = 'investment_view_tab';
            input.type = 'radio';
            input.value = `future_${index}`;
            span.textContent = labelText;
            label.append(input, span);
            control.append(label);
        });
    });

    await expect(segmented).toHaveAttribute('data-segmented-overflow', '1');
    await expect(overflowFrame).toHaveAttribute('data-segmented-overflow', '1');
    await expect(overflowFrame).toHaveAttribute('data-overflow-start', '0');
    await expect(overflowFrame).toHaveAttribute('data-overflow-end', '1');
    await expectEqualWidths();
    const overflowGeometry = await overflowFrame.evaluate((frame) => {
        const control = frame.querySelector('#investment_view_segmented');
        const options = Array.from(control?.querySelectorAll('.segmented-control-option') || []);
        const visibleCount = Number.parseInt(frame.dataset.segmentedVisibleCount || '0', 10);
        const frameRect = frame.getBoundingClientRect();
        const previewRect = options[visibleCount]?.getBoundingClientRect();
        const previewIntersection = previewRect
            ? Math.max(0, Math.min(frameRect.right, previewRect.right) - Math.max(frameRect.left, previewRect.left))
            : 0;
        return {
            controlOverflowY: getComputedStyle(control).overflowY,
            frameMask: getComputedStyle(frame).maskImage,
            previewIntersection,
            previewWidth: previewRect?.width || 0,
            visibleCount,
        };
    });
    expect(overflowGeometry.visibleCount).toBeGreaterThanOrEqual(2);
    expect(overflowGeometry.controlOverflowY).toBe('visible');
    expect(overflowGeometry.frameMask).not.toBe('none');
    expect(overflowGeometry.previewIntersection).toBeGreaterThan(8);
    expect(overflowGeometry.previewIntersection).toBeLessThan(overflowGeometry.previewWidth - 8);

    await segmented.evaluate((control) => {
        const options = Array.from(control.querySelectorAll('.segmented-control-option'));
        const lastOption = options.at(-1);
        const lastInput = lastOption?.querySelector('input');
        if (lastInput instanceof HTMLInputElement) lastInput.checked = true;
        window.ANTIGRAVITY_SEGMENTED_CONTROLS?.sync?.(control, {
            activeIndex: options.length - 1,
            options,
        });
    });
    await expect.poll(() => overflowFrame.evaluate((frame) => frame.scrollLeft)).toBeGreaterThan(0);
    await expect(overflowFrame).toHaveAttribute('data-overflow-start', '1');
    await expect(overflowFrame).toHaveAttribute('data-overflow-end', '0');
    await expectEqualWidths();
});

test('keeps default broker checks without preselecting every active option background', async ({page}) => {
    await mockInvestmentReadApis(page);
    await page.setViewportSize({width: 1_064, height: 863});
    await page.goto('/trade/investment');

    const brokerTrigger = page.locator('#history_table_wrap [data-investment-broker-filter-trigger]');
    await brokerTrigger.click();
    const allOption = page.getByRole('option', {name: 'All', exact: true});
    const ibkrOption = page.getByRole('option', {name: 'IBKR', exact: true});

    await expect(allOption).toHaveClass(/is-active/);
    await expect(ibkrOption).toHaveAttribute('aria-selected', 'true');
    await expect(ibkrOption).toHaveClass(/is-selected/);
    await expect(ibkrOption).not.toHaveClass(/is-active/);
    await expect.poll(() => ibkrOption.evaluate((element) => (
        getComputedStyle(element).backgroundColor
    ))).toBe('rgba(0, 0, 0, 0)');
});

test('keeps Type open for continuous selection until an outside click', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-07-10', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 500, amount: -500},
            {broker: 'ibkr', date: '2026-07-11', type: 'sell', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 501, amount: 501},
            {broker: 'ibkr', date: '2026-07-12', type: 'dividend', ticker: 'QQQ', currency: 'USD', amount: 2},
        ],
    });
    await page.setViewportSize({width: 1_064, height: 863});
    await page.goto('/trade/investment');

    const typeHeader = page.locator('#history_table_wrap th[aria-label="Side"]');
    const historyRows = page.locator('#investment_history > tr:not([data-table-empty-row])');
    await expect(historyRows).toHaveCount(3);
    await typeHeader.hover();
    const typography = await typeHeader.evaluate((header) => {
        const defaultLabel = getComputedStyle(header.querySelector('.investment-side-filter-default-label'));
        const activeLabel = getComputedStyle(header.querySelector('[data-investment-side-filter-label]'));
        const readTypography = (styles) => ({
            fontFamily: styles.fontFamily,
            fontSize: styles.fontSize,
            fontWeight: styles.fontWeight,
            lineHeight: styles.lineHeight,
        });
        return {
            defaultLabel: readTypography(defaultLabel),
            activeLabel: readTypography(activeLabel),
        };
    });
    expect(typography.activeLabel).toEqual(typography.defaultLabel);

    await typeHeader.getByRole('button', {name: 'Type filter: All'}).click();
    await expect(page.getByRole('option', {name: 'All', exact: true})).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('option', {name: 'Buy', exact: true})).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('option', {name: 'Sell', exact: true})).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('option', {name: 'Dividend', exact: true})).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('option', {name: 'All', exact: true}).click();
    await expect(page.locator('#investment_history [data-table-empty-row]')).toContainText(
        'No transactions match the selected filters.',
    );
    await expect(typeHeader.getByRole('button', {name: 'Type filter: None'})).toBeVisible();
    await expect(typeHeader.getByRole('button', {name: 'Type filter: None'})).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('option', {name: 'All', exact: true})).toBeVisible();

    await page.getByRole('option', {name: 'Buy', exact: true}).click();
    await expect(historyRows).toHaveCount(1);
    await expect(typeHeader.getByRole('button', {name: 'Type filter: Buy'})).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('option', {name: 'Sell', exact: true})).toBeVisible();
    await page.getByRole('option', {name: 'Sell', exact: true}).click();
    await expect(historyRows).toHaveCount(2);
    await expect(typeHeader.getByRole('button', {name: 'Type filter: Buy, Sell'})).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('option', {name: 'Dividend', exact: true}).click();
    await expect(historyRows).toHaveCount(3);
    await expect(typeHeader.getByRole('button', {name: 'Type filter: All'})).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('option', {name: 'All', exact: true})).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('option', {name: 'Buy', exact: true})).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('option', {name: 'Sell', exact: true})).toHaveAttribute('aria-selected', 'true');
    await page.locator('#investment_history_surface .chart-heading').click();
    await expect(page.getByRole('option', {name: 'All', exact: true})).toBeHidden();
    await expect(typeHeader.getByRole('button', {name: 'Type filter: All'})).toHaveAttribute('aria-expanded', 'false');
});

test('uses the Type hover disclosure contract for Description and Currency filters', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'ibkr'],
        transactions: [
            {
                ledger_no: 1,
                broker: 'hsbc',
                date: '2026-07-10',
                type: 'deposit',
                currency: 'HKD',
                amount: 500,
                description: 'Unbound receiving deposit',
            },
            {
                ledger_no: 2,
                broker: 'ibkr',
                date: '2026-07-10',
                type: 'withdrawal',
                currency: 'HKD',
                amount: -500,
                description: 'Unbound transfer outflow',
            },
        ],
    });
    await page.setViewportSize({width: 1_064, height: 863});
    await page.goto('/trade/investment');

    const compactFilters = [
        {
            name: 'Type',
            header: page.locator('#history_table_wrap th[aria-label="Side"]'),
            hoverTarget: page.locator('#history_table_wrap th[aria-label="Side"]'),
        },
        {
            name: 'Description',
            header: page.locator('#history_table_wrap th[data-markdown-export-label="Description"]'),
            hoverTarget: page.locator('#history_table_wrap th[data-markdown-export-label="Description"] > div[data-investment-description-filter]'),
        },
        {
            name: 'Currency',
            header: page.locator('#history_table_wrap th[aria-label="Currency"]'),
            hoverTarget: page.locator('#history_table_wrap th[aria-label="Currency"]'),
        },
    ];
    const typeReference = await compactFilters[0].header.evaluate((header) => {
        const activeLabel = header.querySelector('[data-investment-side-filter-label]');
        const style = activeLabel ? getComputedStyle(activeLabel) : null;
        return style ? {
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
            justifyContent: style.justifyContent,
        } : null;
    });
    expect(typeReference).not.toBeNull();

    for (const {name, header, hoverTarget} of compactFilters) {
        await expect(header).toHaveCount(1);
        await expect(hoverTarget).toHaveCount(1);
        await hoverTarget.hover({force: true});
        await expect.poll(() => header.evaluate((element) => {
            const defaultLabel = element.querySelector('.scrollable-data-table-filter-default-label');
            const field = element.querySelector('.scrollable-data-table-filter-field');
            const activeLabel = element.querySelector('.trade-strategy-trigger-label');
            const defaultStyle = defaultLabel ? getComputedStyle(defaultLabel) : null;
            const fieldStyle = field ? getComputedStyle(field) : null;
            const activeStyle = activeLabel ? getComputedStyle(activeLabel) : null;
            return {
                defaultOpacity: defaultStyle?.opacity,
                fieldOpacity: fieldStyle?.opacity,
                activeText: activeLabel?.textContent?.trim(),
                activeTypography: activeStyle ? {
                    fontFamily: activeStyle.fontFamily,
                    fontSize: activeStyle.fontSize,
                    fontWeight: activeStyle.fontWeight,
                    lineHeight: activeStyle.lineHeight,
                    justifyContent: activeStyle.justifyContent,
                } : null,
            };
        }), {message: `${name} filter hover state`}).toEqual({
            defaultOpacity: '0',
            fieldOpacity: '1',
            activeText: 'All',
            activeTypography: typeReference,
        });
    }
});

test('fills the current 1W session axis and stops its realtime curve at the New York minute', async ({page}) => {
    await page.addInitScript(() => {
        const RealDate = Date;
        let fixedTimestamp = new RealDate('2026-08-11T13:42:00Z').valueOf();
        class FixedDate extends RealDate {
            constructor(...args) {
                super(...(args.length ? args : [fixedTimestamp]));
            }

            static now() {
                return fixedTimestamp;
            }
        }
        window.Date = FixedDate;
        window.__setInvestmentOverviewNow = (value) => {
            fixedTimestamp = new RealDate(value).valueOf();
        };

        const nativeSetTimeout = window.setTimeout.bind(window);
        window.setTimeout = (callback, delay, ...args) => {
            if (delay === 60_000 && typeof callback === 'function') {
                window.__testTriggerInvestmentOverviewIntradayPoll = () => callback(...args);
                return 0;
            }
            return nativeSetTimeout(callback, delay, ...args);
        };
    });
    const tradingDays = [
        '2026-07-10',
        '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17',
        '2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24',
        '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31',
        '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07',
        '2026-08-10', '2026-08-11',
    ];
    let quotePrice = 120;
    let marketAsOf = '2026-08-11T09:42:00-04:00';
    const marketSessionDayCounts = [];
    const liveQuotes = () => [{
        ticker: 'QQQ',
        price: quotePrice,
        timestamp: '',
        session: 'intraday',
        session_date: '2026-08-11',
        market: 'US',
        source: 'longbridge',
    }];
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                date: '2026-08-04',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 1,
                price: 100,
                amount: -100,
            },
        ],
        tradingDays,
        priceHistoryByTicker: {
            QQQ: tradingDays.map((date) => ({date, close: 100})),
        },
        realtimeQuotes: liveQuotes,
        marketSession: (url) => {
            const dayCount = Number(url.searchParams.get('day_count')) || 5;
            marketSessionDayCounts.push(dayCount);
            return {
                session: 'intraday',
                is_trading_day: true,
                is_realtime_allowed: true,
                session_date: '2026-08-11',
                as_of: marketAsOf,
                trading_days: tradingDays.slice(-dayCount),
            };
        },
        intradayRows: (url) => {
            const requestedDays = String(url.searchParams.get('days') || '').split(',').filter(Boolean);
            return requestedDays.flatMap((day) => {
                const minuteCount = day === '2026-08-11' ? 12 : 390;
                return Array.from({length: minuteCount}, (_, minuteOffset) => {
                    const totalMinutes = (9 * 60) + 30 + minuteOffset;
                    const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
                    const minutes = String(totalMinutes % 60).padStart(2, '0');
                    const close = 100 + (minuteOffset * 0.01);
                    return {
                        date: `${day} ${hours}:${minutes}`,
                        open: close,
                        high: close,
                        low: close,
                        close,
                    };
                });
            });
        },
    });
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment?view=overview&range=1w');

    const readCurveState = () => page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const labels = chart?.data?.rawLabels || [];
        const values = chart?.data?.datasets?.[0]?.data || [];
        const finiteIndexes = values
            .map((value, index) => Number.isFinite(value) ? index : -1)
            .filter((index) => index >= 0);
        const lastFiniteIndex = finiteIndexes[finiteIndexes.length - 1] ?? -1;
        const currentIndex = labels.indexOf('2026-08-11 09:42');
        return {
            labelCount: labels.length,
            firstCurrentDayLabel: labels.find((label) => label.startsWith('2026-08-11')) || '',
            finalAxisLabel: labels[labels.length - 1] || '',
            lastFiniteLabel: labels[lastFiniteIndex] || '',
            currentValue: currentIndex >= 0 ? values[currentIndex] : null,
            futureValuesAreNull: values.slice(currentIndex + 1).every((value) => value === null),
            holdingsTotalEquity: Number(
                document.querySelector('[data-investment-live-field="summary_total_equity"]')
                    ?.dataset.investmentLiveNumber,
            ),
        };
    });
    await expect.poll(readCurveState, {timeout: 30_000}).toEqual({
        labelCount: 5 * 390,
        firstCurrentDayLabel: '2026-08-11 09:30',
        finalAxisLabel: '2026-08-11 15:59',
        lastFiniteLabel: '2026-08-11 09:42',
        currentValue: 10_020,
        futureValuesAreNull: true,
        holdingsTotalEquity: 10_020,
    });
    await expect.poll(() => page.locator('[data-investment-equity-live-marker]').evaluate(
        (element) => !element.hidden,
    )).toBe(true);

    const tooltip = page.locator('[data-investment-chart-tooltip="1"]');
    const activateCurveMinuteTooltip = async (minuteKey) => {
        await expect.poll(() => page.evaluate((label) => {
            const canvas = document.querySelector('#investmentEquityChart');
            const chart = window.Chart?.getChart(canvas);
            const index = chart?.data?.rawLabels?.indexOf(label) ?? -1;
            const element = index >= 0 ? chart?.getDatasetMeta(0)?.data?.[index] : null;
            if (!chart || !element || element.skip) return false;
            const center = element.getCenterPoint();
            chart.setActiveElements([{datasetIndex: 0, index}]);
            chart.tooltip?.setActiveElements(
                [{datasetIndex: 0, index}],
                {x: center.x, y: center.y},
            );
            chart.update('none');
            return true;
        }, minuteKey)).toBe(true);
        await expect(tooltip).toHaveClass(/is-visible/);
    };
    const readTooltipPnl = () => tooltip.locator('.chart-tooltip-row').evaluateAll((rows) => (
        rows.slice(-3).map((row) => ({
            label: row.querySelector('.chart-tooltip-label')?.textContent || '',
            value: Number(
                String(row.querySelector('.chart-tooltip-value')?.textContent || '')
                    .replace(/[^0-9.-]/g, ''),
            ),
        }))
    ));
    const expectTooltipPnlAtInstant = async (expectedRows) => {
        await expect.poll(readTooltipPnl).toEqual(expectedRows);
        const [realizedRow, unrealizedRow, cumulativeRow] = await readTooltipPnl();
        expect(cumulativeRow.value).toBe(Number(
            (realizedRow.value + unrealizedRow.value).toFixed(2),
        ));
    };

    await activateCurveMinuteTooltip('2026-08-11 09:42');
    await expect(tooltip.locator('.chart-tooltip-date')).toHaveText('11 Aug 2026 09:42');
    await expectTooltipPnlAtInstant([
        {label: 'Realized P&L', value: 0},
        {label: 'Unrealized P&L', value: 20},
        {label: 'Cumulative P&L', value: 20},
    ]);

    quotePrice = 125;
    marketAsOf = '2026-08-11T09:43:00-04:00';
    await page.evaluate(() => window.__setInvestmentOverviewNow('2026-08-11T13:43:00Z'));
    await expect.poll(() => page.evaluate(() => (
        typeof window.__testTriggerInvestmentOverviewIntradayPoll
    ))).toBe('function');
    const realtimeResponse = page.waitForResponse((response) => (
        response.url().includes('/api/investment/realtime-quotes')
    ));
    await page.evaluate(() => window.__testTriggerInvestmentOverviewIntradayPoll());
    await realtimeResponse;
    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const labels = chart?.data?.rawLabels || [];
        const values = chart?.data?.datasets?.[0]?.data || [];
        const firstLiveIndex = labels.indexOf('2026-08-11 09:42');
        const secondLiveIndex = labels.indexOf('2026-08-11 09:43');
        const finiteIndexes = values
            .map((value, index) => Number.isFinite(value) ? index : -1)
            .filter((index) => index >= 0);
        return {
            firstLiveValue: values[firstLiveIndex],
            secondLiveValue: values[secondLiveIndex],
            lastFiniteLabel: labels[finiteIndexes[finiteIndexes.length - 1]],
            futureValuesAreNull: values.slice(secondLiveIndex + 1).every((value) => value === null),
        };
    })).toEqual({
        firstLiveValue: 10_020,
        secondLiveValue: 10_025,
        lastFiniteLabel: '2026-08-11 09:43',
        futureValuesAreNull: true,
    });

    await activateCurveMinuteTooltip('2026-08-11 09:43');
    await expect(tooltip.locator('.chart-tooltip-date')).toHaveText('11 Aug 2026 09:43');
    await expectTooltipPnlAtInstant([
        {label: 'Realized P&L', value: 0},
        {label: 'Unrealized P&L', value: 25},
        {label: 'Cumulative P&L', value: 25},
    ]);

    await activateCurveMinuteTooltip('2026-08-11 09:42');
    await expect(tooltip.locator('.chart-tooltip-date')).toHaveText('11 Aug 2026 09:42');
    await expectTooltipPnlAtInstant([
        {label: 'Realized P&L', value: 0},
        {label: 'Unrealized P&L', value: 20},
        {label: 'Cumulative P&L', value: 20},
    ]);

    await page.locator('label[for="investment_equity_range_1m"]').click();
    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const labels = chart?.data?.rawLabels || [];
        const values = chart?.data?.datasets?.[0]?.data || [];
        const historicalIndex = labels.indexOf('2026-08-10 09:30');
        const currentIndex = labels.indexOf('2026-08-11 09:43');
        const finiteIndexes = values
            .map((value, index) => Number.isFinite(value) ? index : -1)
            .filter((index) => index >= 0);
        return {
            labelCount: labels.length,
            finalAxisLabel: labels[labels.length - 1] || '',
            historicalValue: values[historicalIndex],
            lastFiniteLabel: labels[finiteIndexes[finiteIndexes.length - 1]] || '',
            futureValuesAreNull: values.slice(currentIndex + 1).every((value) => value === null),
        };
    }), {timeout: 30_000}).toEqual({
        labelCount: 23 * 390,
        finalAxisLabel: '2026-08-11 15:59',
        historicalValue: 10_000,
        lastFiniteLabel: '2026-08-11 09:43',
        futureValuesAreNull: true,
    });

    quotePrice = 130;
    marketAsOf = '2026-08-11T09:44:00-04:00';
    await page.evaluate(() => window.__setInvestmentOverviewNow('2026-08-11T13:44:00Z'));
    const sessionRequestCountBeforeSecondPoll = marketSessionDayCounts.length;
    const secondRealtimeResponse = page.waitForResponse((response) => (
        response.url().includes('/api/investment/realtime-quotes')
    ));
    await page.evaluate(() => window.__testTriggerInvestmentOverviewIntradayPoll());
    await secondRealtimeResponse;
    expect(marketSessionDayCounts.length).toBeGreaterThan(sessionRequestCountBeforeSecondPoll);
    expect(marketSessionDayCounts.at(-1)).toBe(23);
    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const labels = chart?.data?.rawLabels || [];
        const values = chart?.data?.datasets?.[0]?.data || [];
        const currentIndex = labels.indexOf('2026-08-11 09:44');
        const finiteIndexes = values
            .map((value, index) => Number.isFinite(value) ? index : -1)
            .filter((index) => index >= 0);
        return {
            labelCount: labels.length,
            currentValue: values[currentIndex],
            lastFiniteLabel: labels[finiteIndexes[finiteIndexes.length - 1]] || '',
            futureValuesAreNull: values.slice(currentIndex + 1).every((value) => value === null),
        };
    })).toEqual({
        labelCount: 23 * 390,
        currentValue: 10_030,
        lastFiniteLabel: '2026-08-11 09:44',
        futureValuesAreNull: true,
    });

    await activateCurveMinuteTooltip('2026-08-11 09:44');
    await expect(tooltip.locator('.chart-tooltip-date')).toHaveText('11 Aug 2026 09:44');
    await expectTooltipPnlAtInstant([
        {label: 'Realized P&L', value: 0},
        {label: 'Unrealized P&L', value: 30},
        {label: 'Cumulative P&L', value: 30},
    ]);
});

test('keeps the completed regular curve and appends an overnight live equity marker', async ({page}) => {
    await page.addInitScript(() => {
        const RealDate = Date;
        const fixedTimestamp = new RealDate('2026-08-12T06:00:00Z').valueOf();
        class FixedDate extends RealDate {
            constructor(...args) {
                super(...(args.length ? args : [fixedTimestamp]));
            }

            static now() {
                return fixedTimestamp;
            }
        }
        window.Date = FixedDate;
    });
    const tradingDays = [
        '2026-08-05',
        '2026-08-06',
        '2026-08-07',
        '2026-08-10',
        '2026-08-11',
    ];
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                date: '2026-08-04',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 1,
                price: 100,
                amount: -100,
            },
        ],
        tradingDays,
        priceHistoryByTicker: {
            QQQ: tradingDays.map((date) => ({date, close: 100})),
        },
        realtimeQuotes: [{
            ticker: 'QQQ',
            price: 120,
            timestamp: '2026-08-12 02:00',
            session: 'overnight',
            session_date: '2026-08-12',
            market: 'US',
            source: 'longbridge',
        }],
        marketSession: {
            session: 'overnight',
            is_trading_day: true,
            is_realtime_allowed: true,
            session_date: '2026-08-12',
            as_of: '2026-08-12T02:00:00-04:00',
        },
        intradayRows: (url) => {
            const requestedDays = String(url.searchParams.get('days') || '').split(',').filter(Boolean);
            return requestedDays.flatMap((day) => Array.from({length: 390}, (_, minuteOffset) => {
                const totalMinutes = (9 * 60) + 30 + minuteOffset;
                const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
                const minutes = String(totalMinutes % 60).padStart(2, '0');
                const close = 100 + (minuteOffset * 0.01);
                return {
                    date: `${day} ${hours}:${minutes}`,
                    open: close,
                    high: close,
                    low: close,
                    close,
                };
            }));
        },
    });
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment?view=overview&range=1w');

    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const labels = chart?.data?.rawLabels || [];
        const values = chart?.data?.datasets?.[0]?.data || [];
        const currentDayValues = labels
            .map((label, index) => ({label, value: values[index]}))
            .filter(({label}) => label.startsWith('2026-08-11'));
        const marker = document.querySelector('[data-investment-equity-live-marker]');
        return {
            labelCount: labels.length,
            historicalStart: currentDayValues[0]?.value ?? null,
            historicalEnd: currentDayValues.at(-1)?.value ?? null,
            lastLabel: labels.at(-1) || '',
            lastValue: values.at(-1) ?? null,
            markerHidden: marker?.hidden ?? true,
            holdingsTotalEquity: Number(
                document.querySelector('[data-investment-live-field="summary_total_equity"]')
                    ?.dataset.investmentLiveNumber,
            ),
        };
    }), {timeout: 30_000}).toEqual({
        labelCount: (5 * 390) + 1,
        historicalStart: 10_000,
        historicalEnd: 10_003.89,
        lastLabel: '2026-08-12 02:00',
        lastValue: 10_020,
        markerHidden: false,
        holdingsTotalEquity: 10_020,
    });

    const markerState = await page.locator('[data-investment-equity-live-marker]').evaluate((element) => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const lastIndex = chart.data.labels.length - 1;
        const lastValue = Number(chart.data.datasets[0].data[lastIndex]);
        return {
            left: Number.parseFloat(element.style.left),
            top: Number.parseFloat(element.style.top),
            expectedLeft: chart.scales.x.getPixelForValue(lastIndex),
            expectedTop: chart.scales.y.getPixelForValue(lastValue),
        };
    });
    expect(Math.abs(markerState.left - markerState.expectedLeft)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(markerState.top - markerState.expectedTop)).toBeLessThanOrEqual(0.5);
});

test('renders the 1M investment equity curve from the requested high-precision calendar', async ({page}) => {
    const tradingDays = [
        '2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19',
        '2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26',
        '2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03',
        '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10',
        '2026-07-13', '2026-07-14', '2026-07-15',
    ];
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-06-01', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 500, amount: -500},
        ],
        tradingDays,
        intradayRows: (url) => {
            const requestedDays = String(url.searchParams.get('days') || '').split(',').filter(Boolean);
            return requestedDays.slice(-2).flatMap((day, dayIndex) => Array.from({length: 390}, (_, minuteOffset) => {
                const totalMinutes = (9 * 60) + 30 + minuteOffset;
                const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
                const minutes = String(totalMinutes % 60).padStart(2, '0');
                const close = 500 + (dayIndex * 390) + minuteOffset;
                return {date: `${day} ${hours}:${minutes}`, open: close, high: close, low: close, close};
            }));
        },
    });
    await page.addInitScript(() => {
        const originalFillText = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
            if (this.canvas?.id === 'investmentEquityChart') {
                window.__investmentEquityCanvasLabels = [
                    ...(window.__investmentEquityCanvasLabels || []),
                    String(text),
                ];
            }
            return originalFillText.call(this, text, ...args);
        };
    });
    await page.setViewportSize({width: 919, height: 1_090});
    await page.goto('/trade/investment');
    await expect.poll(() => page.evaluate(() => Boolean(window.Chart?.getChart?.(document.querySelector('#investmentEquityChart'))))).toBe(true);

    await page.evaluate(() => {
        window.__investmentEquityCanvasLabels = [];
    });
    await page.locator('label[for="investment_equity_range_1m"]').click();
    await expect.poll(() => page.evaluate(() => {
        const canvas = document.querySelector('#investmentEquityChart');
        const chart = window.Chart?.getChart(canvas);
        const values = chart?.data?.datasets?.[0]?.data || [];
        const stack = canvas?.closest('.investment-chart-stack');
        return {
            labelCount: chart?.data?.labels?.length || 0,
            finiteCount: values.filter(Number.isFinite).length,
            yScaleMax: Number(chart?.options?.scales?.y?.max),
            dataMax: Math.max(...values.filter(Number.isFinite)),
            peakGuard: getComputedStyle(stack).getPropertyValue('--investment-equity-peak-guard').trim(),
        };
    }), {timeout: 30_000}).toEqual(expect.objectContaining({
        labelCount: 23 * 390,
        finiteCount: 2 * 390,
        peakGuard: '5px',
    }));
    const scaleSafety = await page.evaluate(() => {
        const canvas = document.querySelector('#investmentEquityChart');
        const chart = window.Chart?.getChart(canvas);
        const values = chart.data.datasets[0].data.filter(Number.isFinite);
        return {dataMax: Math.max(...values), yScaleMax: Number(chart.options.scales.y.max)};
    });
    expect(scaleSafety.yScaleMax).toBeGreaterThan(scaleSafety.dataMax);

    const expectDateOnlyAxisLabels = async () => {
        await expect.poll(() => page.evaluate(() => {
            const labels = window.__investmentEquityCanvasLabels || [];
            return {
                hasDate: labels.some((label) => /^\d{1,2} [A-Za-z]{3}$/.test(label)),
                hasYear: labels.some((label) => /^\d{4}$/.test(label)),
                timeCount: labels.filter((label) => /\b\d{1,2}:\d{2}\b/.test(label)).length,
            };
        })).toEqual({
            hasDate: true,
            hasYear: true,
            timeCount: 0,
        });
    };
    await expectDateOnlyAxisLabels();

    await page.evaluate(() => {
        window.__investmentEquityCanvasLabels = [];
    });
    await page.locator('label[for="investment_equity_range_1w"]').click();
    await expect.poll(() => page.evaluate(() => {
        const canvas = document.querySelector('#investmentEquityChart');
        return window.Chart?.getChart(canvas)?.data?.labels?.length || 0;
    }), {timeout: 30_000}).toBe(5 * 390);
    await expectDateOnlyAxisLabels();
});

test('carries each ticker intraday close forward across interleaved missing bars', async ({page}) => {
    const tradingDays = [
        '2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19',
    ];
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-06-01', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 100, amount: -100},
            {broker: 'ibkr', date: '2026-06-01', type: 'buy', ticker: 'SPY', currency: 'USD', quantity: 1, price: 200, amount: -200},
        ],
        tradingDays,
        priceHistoryByTicker: {
            QQQ: [{date: '2026-06-01', close: 100}],
            SPY: [{date: '2026-06-01', close: 200}],
        },
        intradayRows: (url) => {
            const ticker = String(url.searchParams.get('ticker') || '');
            const requestedDays = String(url.searchParams.get('days') || '').split(',').filter(Boolean);
            return requestedDays.flatMap((day) => {
                const bars = ticker === 'QQQ'
                    ? [
                        ['09:30', 100], ['09:32', 102], ['09:34', 104], ['09:36', 106],
                        ['09:38', 108], ['09:40', 110], ['09:42', 112], ['09:44', 114],
                    ]
                    : [
                        ['09:31', 201], ['09:33', 203], ['09:35', 205], ['09:37', 207],
                        ['09:39', 209], ['09:41', 211], ['09:43', 213], ['09:45', 215],
                    ];
                return bars.map(([time, close]) => ({
                    date: `${day} ${time}`,
                    open: close,
                    high: close,
                    low: close,
                    close,
                }));
            });
        },
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_equity_range_1w"]').click();
    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        return (chart?.data?.rawLabels || []).map((date, index) => ({
            date,
            value: chart.data.datasets?.[0]?.data?.[index] ?? null,
        })).filter((point) => point.date.startsWith('2026-06-15 09:3')).slice(0, 4);
    }).then((points) => points.map((point) => point.value)), {timeout: 30_000}).toEqual([
        null, 10_001, 10_003, 10_005,
    ]);
});

test('replays trusted intraday fills by minute and carries date-only trades into the next session', async ({page}) => {
    const tradingDays = [
        '2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19',
    ];
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                broker: 'ibkr',
                date: '2026-06-12',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 10,
                price: 100,
                amount: -1_000,
            },
            {
                broker: 'ibkr',
                date: '2026-06-15',
                datetime: '2026-06-15 10:00:00',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 5,
                price: 102,
                amount: -510,
                source: {source_has_intraday_timestamp: true},
            },
            {
                broker: 'ibkr',
                date: '2026-06-15',
                datetime: '2026-06-15 10:02:00',
                type: 'sell',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 3,
                price: 105,
                amount: 315,
                source: {source_has_intraday_timestamp: true},
            },
            {
                broker: 'ibkr',
                date: '2026-06-15',
                datetime: '2026-06-15 20:00:00',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 2,
                price: 106,
                amount: -212,
                source: {source_has_intraday_timestamp: false},
            },
        ],
        tradingDays,
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-06-12', close: 100},
                {date: '2026-06-15', close: 105},
                {date: '2026-06-16', close: 106},
            ],
        },
        intradayRows: (url) => {
            const requestedDays = String(url.searchParams.get('days') || '').split(',').filter(Boolean);
            return requestedDays.flatMap((day) => {
                const closes = day === '2026-06-15'
                    ? [['09:30', 100], ['10:00', 102], ['10:01', 103], ['10:02', 104], ['10:03', 105]]
                    : day === '2026-06-16'
                        ? [['09:30', 106]]
                        : [['09:30', 106]];
                return closes.map(([time, close]) => ({
                    date: `${day} ${time}`,
                    open: close,
                    high: close,
                    low: close,
                    close,
                }));
            });
        },
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_equity_range_1w"]').click();
    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const valuesByMinute = new Map((chart?.data?.rawLabels || []).map((date, index) => [
            date,
            chart?.data?.datasets?.[0]?.data?.[index],
        ]));
        return Object.fromEntries([
            '2026-06-15 10:00',
            '2026-06-15 10:01',
            '2026-06-15 10:02',
            '2026-06-15 10:03',
            '2026-06-16 09:30',
        ].map((minuteKey) => [minuteKey, valuesByMinute.get(minuteKey)]));
    }), {timeout: 30_000}).toEqual({
        '2026-06-15 10:00': 10_020,
        '2026-06-15 10:01': 10_035,
        '2026-06-15 10:02': 10_050,
        '2026-06-15 10:03': 10_065,
        '2026-06-16 09:30': 10_077,
    });
});

test('renders trailing overnight and pre-market buy glow zones in the stock-details gap', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                broker: 'ibkr',
                date: '2026-06-15',
                datetime: '2026-06-15 10:00:00',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 10,
                price: 100,
                amount: -1_000,
                source: {source_has_intraday_timestamp: true},
            },
            {
                broker: 'ibkr',
                date: '2026-06-16',
                datetime: '2026-06-16 21:00:00',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 2,
                price: 104,
                amount: -208,
                source: {source_has_intraday_timestamp: true},
            },
            {
                broker: 'ibkr',
                date: '2026-06-17',
                datetime: '2026-06-17 00:20:00',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 2,
                price: 103,
                amount: -206,
                source: {source_has_intraday_timestamp: true},
            },
            {
                broker: 'ibkr',
                date: '2026-06-17',
                datetime: '2026-06-17 05:00:00',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 2,
                price: 102,
                amount: -204,
                source: {source_has_intraday_timestamp: true},
            },
        ],
        tradingDays: ['2026-06-15', '2026-06-16'],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-06-15', close: 100},
                {date: '2026-06-16', close: 104},
                {date: '2026-06-17', close: 102},
            ],
        },
        intradayRows: () => [
            {date: '2026-06-15 09:30', open: 99, high: 101, low: 98, close: 100},
            {date: '2026-06-15 15:59', open: 100, high: 102, low: 99, close: 101},
            {date: '2026-06-16 09:30', open: 103, high: 105, low: 102, close: 104},
            {date: '2026-06-16 15:59', open: 104, high: 106, low: 103, close: 105},
        ],
    });
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment?view=stock-details&ticker=QQQ&range=1w');

    const canvas = page.locator('.investment-stock-details-price-chart-canvas');
    await expect.poll(() => canvas.evaluate((element) => {
        const chart = window.Chart?.getChart(element);
        return Boolean(chart?.chartArea && chart.data?.labels?.length === 4);
    }), {timeout: 30_000}).toBe(true);

    const markerGaps = await canvas.evaluate((element) => {
        const chart = window.Chart?.getChart(element);
        const context = element.getContext('2d');
        const lastIndex = (chart?.data?.labels?.length || 1) - 1;
        const lastPointX = Number(chart?.getDatasetMeta(0)?.data?.[lastIndex]?.x);
        const yScale = chart?.scales?.y;
        const hasGreenPixelsNear = (x, y) => {
            if (!context || !Number.isFinite(x) || !Number.isFinite(y)) return false;
            const centerX = Math.round(x);
            const centerY = Math.round(y);
            const left = Math.max(0, centerX - 9);
            const top = Math.max(0, centerY - 24);
            const right = Math.min(element.width, centerX + 10);
            const bottom = Math.min(element.height, centerY + 25);
            const image = context.getImageData(left, top, Math.max(1, right - left), Math.max(1, bottom - top)).data;
            for (let index = 0; index < image.length; index += 4) {
                const red = image[index];
                const green = image[index + 1];
                const blue = image[index + 2];
                if (green > 90 && green > red * 1.2 && green > blue * 1.05) return true;
            }
            return false;
        };
        return {
            lastPointX,
            nightGreen: hasGreenPixelsNear(lastPointX, yScale?.getPixelForValue(104)),
            overnightGreen: hasGreenPixelsNear(lastPointX, yScale?.getPixelForValue(103)),
            preMarketGreen: hasGreenPixelsNear(lastPointX, yScale?.getPixelForValue(102)),
        };
    });
    expect(markerGaps.nightGreen).toBe(true);
    expect(markerGaps.overnightGreen).toBe(true);
    expect(markerGaps.preMarketGreen).toBe(true);
});

test('does not pre-fund an earlier booking date with future sale proceeds', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                broker: 'ibkr',
                date: '2025-03-12',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 150,
                price: 100,
                amount: -15_000,
            },
            {
                broker: 'ibkr',
                date: '2025-03-15',
                type: 'sell',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 150,
                price: 100,
                amount: 15_000,
            },
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2025-03-12', close: 100},
                {date: '2025-03-13', close: 100},
                {date: '2025-03-14', close: 100},
                {date: '2025-03-15', close: 100},
            ],
        },
    });
    await page.goto('/trade/investment?range=max');
    await expect.poll(() => page.evaluate(() => (
        window.Chart?.getChart(document.querySelector('#investmentEquityChart'))?.data?.rawLabels?.length || 0
    ))).toBeGreaterThan(0);

    const chartValues = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        return (chart?.data?.rawLabels || []).map((date, index) => ({
            date,
            value: Number(chart.data.datasets?.[0]?.data?.[index]),
        }));
    });
    for (const date of ['2025-03-12', '2025-03-13', '2025-03-14', '2025-03-15']) {
        expect(chartValues.find((point) => point.date === date)?.value).toBeCloseTo(10_000, 8);
    }
    expect(chartValues.some((point) => Math.abs(point.value - 10_000) > 0.01)).toBe(false);

    await page.locator('label[for="investment_view_holdings"]').click();
    const endpointAndHoldings = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const values = chart?.data?.datasets?.[0]?.data || [];
        return {
            chartEndpoint: Number(values[values.length - 1]),
            holdingsTotalEquity: Number(
                document.querySelector('[data-investment-live-field="summary_total_equity"]')?.dataset.investmentLiveNumber,
            ),
        };
    });
    expect(endpointAndHoldings.chartEndpoint).toBeCloseTo(endpointAndHoldings.holdingsTotalEquity, 8);
});

test('syncs the overview donut to the hovered 1W and 1M valuation point', async ({page}) => {
    const tradingDays = [
        '2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19',
        '2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26',
        '2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03',
        '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10',
        '2026-07-13', '2026-07-14', '2026-07-15',
    ];
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-06-01', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 20, price: 100, amount: -2000},
            {broker: 'ibkr', date: '2026-06-01', type: 'buy', ticker: 'SPY', currency: 'USD', quantity: 20, price: 100, amount: -2000},
        ],
        tradingDays,
        intradayRows: (url) => {
            const ticker = String(url.searchParams.get('ticker') || '');
            const requestedDays = String(url.searchParams.get('days') || '').split(',').filter(Boolean);
            return requestedDays.flatMap((day, dayIndex) => Array.from({length: 390}, (_, minuteOffset) => {
                const totalMinutes = (9 * 60) + 30 + minuteOffset;
                const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
                const minutes = String(totalMinutes % 60).padStart(2, '0');
                const close = ticker === 'QQQ'
                    ? 100 + (dayIndex * 8) + (minuteOffset * 0.5)
                    : 300 - (dayIndex * 4) - (minuteOffset * 0.4);
                return {date: `${day} ${hours}:${minutes}`, open: close, high: close, low: close, close};
            }));
        },
    });
    await page.setViewportSize({width: 919, height: 1_090});
    await page.goto('/trade/investment');

    const moveToChartPoint = async (index) => {
        const point = await page.evaluate((pointIndex) => {
            const canvas = document.querySelector('#investmentEquityChart');
            const chart = window.Chart?.getChart(canvas);
            const element = chart?.getDatasetMeta(0)?.data?.[pointIndex];
            if (!canvas || !element) return null;
            const center = element.getCenterPoint();
            const rect = canvas.getBoundingClientRect();
            return {x: rect.left + center.x, y: rect.top + center.y};
        }, index);
        expect(point).not.toBeNull();
        await page.mouse.move(point.x, point.y);
        await expect.poll(() => page.locator(
            '[data-investment-chart-tooltip="1"] .chart-tooltip-label',
        ).evaluateAll((labels) => labels.slice(-3).map((label) => label.textContent))).toEqual([
            'Realized P&L',
            'Unrealized P&L',
            'Cumulative P&L',
        ]);
        await expect(page.locator(
            '[data-investment-chart-tooltip="1"] .chart-tooltip-label',
        ).filter({hasText: /^P&L$/})).toHaveCount(0);
        return expect.poll(() => page.locator('#investment_dummy_donut').evaluate((donut) => (
            donut.style.getPropertyValue('--portfolio-donut-fill')
        ))).not.toBe('');
    };

    for (const [range, dayCount] of [['1w', 5], ['1m', 23]]) {
        await page.locator(`label[for="investment_equity_range_${range}"]`).click();
        await expect.poll(() => page.evaluate(() => (
            window.Chart?.getChart(document.querySelector('#investmentEquityChart'))?.data?.datasets?.[0]?.data
                ?.filter(Number.isFinite).length || 0
        )), {timeout: 30_000}).toBe(dayCount * 390);
        await moveToChartPoint(0);
        const openingFill = await page.locator('#investment_dummy_donut').evaluate((donut) => (
            donut.style.getPropertyValue('--portfolio-donut-fill')
        ));
        await moveToChartPoint((dayCount * 390) - 1);
        await expect.poll(() => page.locator('#investment_dummy_donut').evaluate((donut) => (
            donut.style.getPropertyValue('--portfolio-donut-fill')
        ))).not.toBe(openingFill);
    }
});

test('shows hovered total equity in the shared blue y-axis badge across every Overview range', async ({page}) => {
    const dailyHistory = Array.from({length: 590}, (_, index) => {
        const date = new Date(Date.UTC(2025, 0, 1 + index));
        return {
            date: date.toISOString().slice(0, 10),
            close: 100 + (index * 0.1),
        };
    });
    const tradingDays = Array.from({length: 23}, (_, index) => {
        const date = new Date(Date.UTC(2026, 6, 13 + index));
        return date.toISOString().slice(0, 10);
    });
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2025-01-02', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 10, price: 100, amount: -1_000},
        ],
        tradingDays,
        priceHistoryByTicker: {QQQ: dailyHistory},
        intradayRows: (url) => String(url.searchParams.get('days') || '')
            .split(',')
            .filter(Boolean)
            .flatMap((day, dayIndex) => [
                {date: `${day} 09:30`, open: 150 + dayIndex, high: 150 + dayIndex, low: 150 + dayIndex, close: 150 + dayIndex},
                {date: `${day} 15:59`, open: 151 + dayIndex, high: 151 + dayIndex, low: 151 + dayIndex, close: 151 + dayIndex},
            ]),
    });
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment?view=overview&range=1m');

    for (const range of ['1w', '1m', '3m', 'ytd', '1y', 'max']) {
        await page.locator(`label[for="investment_equity_range_${range}"]`).click();
        await expect(page.locator(`#investment_equity_range_${range}`)).toBeChecked();
        await expect.poll(() => page.evaluate(() => (
            window.Chart?.getChart(document.querySelector('#investmentEquityChart'))
                ?.data?.datasets?.[0]?.data?.filter(Number.isFinite).length || 0
        )), {timeout: 30_000}).toBeGreaterThan(0);

        const badge = await page.evaluate(() => {
            const canvas = document.querySelector('#investmentEquityChart');
            const chart = window.Chart?.getChart(canvas);
            const dataset = chart?.data?.datasets?.[0]?.data || [];
            const finiteIndexes = dataset
                .map((value, index) => Number.isFinite(value) ? index : -1)
                .filter((index) => index >= 0);
            const index = finiteIndexes[Math.floor(finiteIndexes.length / 2)];
            const point = chart?.getDatasetMeta(0)?.data?.[index];
            if (!canvas || !chart || !Number.isInteger(index) || !point) return null;
            const center = point.getCenterPoint();
            chart.setActiveElements([{datasetIndex: 0, index}]);
            chart.tooltip?.setActiveElements(
                [{datasetIndex: 0, index}],
                {x: center.x, y: center.y},
            );
            chart.update('none');
            const bounds = chart._activeInvestmentEquityGuideBounds;
            const equity = Number(dataset[index]);
            if (!bounds || !Number.isFinite(equity)) return null;
            return {
                allocationBadgeRadius: getComputedStyle(canvas)
                    .getPropertyValue('--investment-holdings-allocation-badge-radius').trim(),
                badgeCoversAxis: bounds.badgeLeft < chart.chartArea.left
                    && bounds.badgeRight > chart.chartArea.left - 4,
                badgeWithinCanvas: bounds.badgeLeft >= 0 && bounds.badgeRight <= canvas.clientWidth,
                equityDelta: Math.abs(bounds.equity - equity),
                formattedEquity: bounds.formattedEquity,
                expectedFormattedEquity: new Intl.NumberFormat('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                }).format(equity),
                yDelta: Math.abs(bounds.y - chart.scales.y.getPixelForValue(equity)),
                yWithinPlot: bounds.y >= chart.chartArea.top && bounds.y <= chart.chartArea.bottom,
            };
        });
        expect(badge).toEqual({
            allocationBadgeRadius: '2px',
            badgeCoversAxis: true,
            badgeWithinCanvas: true,
            equityDelta: 0,
            formattedEquity: badge?.expectedFormattedEquity,
            expectedFormattedEquity: badge?.expectedFormattedEquity,
            yDelta: 0,
            yWithinPlot: true,
        });
    }
});

test('reuses Frosted Glass Overview Tooltip DOM on one valuation point', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-06-01', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 100, amount: -100},
        ],
        priceHistoryByTicker: {
            QQQ: [{date: '2026-06-01', close: 100}],
        },
    });
    await page.goto('/trade/investment');
    const readPoint = () => page.evaluate(() => {
        const canvas = document.querySelector('#investmentEquityChart');
        const chart = window.Chart?.getChart(canvas);
        const element = chart?.getDatasetMeta(0)?.data?.[0];
        if (!canvas || !element) return null;
        const center = element.getCenterPoint();
        const rect = canvas.getBoundingClientRect();
        return {x: rect.left + center.x, y: rect.top + center.y};
    });
    await expect.poll(readPoint).not.toBeNull();
    const point = await readPoint();

    await page.mouse.move(point.x, point.y);
    const tooltip = page.locator('[data-investment-chart-tooltip="1"]');
    await expect(tooltip).toHaveClass(/is-visible/);
    expect(await tooltip.locator('.chart-tooltip-label').evaluateAll((labels) => (
        labels.slice(-3).map((label) => label.textContent)
    ))).toEqual([
        'Realized P&L',
        'Unrealized P&L',
        'Cumulative P&L',
    ]);
    await expect(tooltip.locator('.chart-tooltip-label').filter({hasText: /^P&L$/})).toHaveCount(0);
    await expect.poll(() => tooltip.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
            transform: style.transform,
            willChange: style.willChange,
        };
    })).toMatchObject({
        backdropFilter: expect.stringContaining('blur'),
        transform: expect.not.stringMatching(/^none$/),
        willChange: expect.stringContaining('transform'),
    });

    await page.evaluate(() => {
        const list = document.querySelector('[data-investment-chart-tooltip="1"] .chart-tooltip-list');
        let mutationCount = 0;
        const observer = new MutationObserver((records) => {
            mutationCount += records.length;
        });
        observer.observe(list, {childList: true});
        window.__investmentTooltipMutationCount = () => mutationCount;
    });
    for (const offset of [-3, -1, 1, 3]) {
        await page.mouse.move(point.x + offset, point.y);
    }
    await page.waitForTimeout(100);
    await expect.poll(() => page.evaluate(() => (
        window.__investmentTooltipMutationCount?.() || 0
    ))).toBeLessThan(2);

    await page.mouse.move(0, 0);
    await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        if (!chart) return;
        const originalUpdate = chart.update.bind(chart);
        const originalDraw = chart.draw.bind(chart);
        const calls = {draw: 0, update: 0};
        chart.update = (...args) => {
            calls.update += 1;
            return originalUpdate(...args);
        };
        chart.draw = (...args) => {
            calls.draw += 1;
            return originalDraw(...args);
        };
        window.__investmentHoverChartCalls = () => ({...calls});
    });
    await page.locator('#investment_history tr[data-investment-history-row]').first().hover();
    await expect.poll(() => page.evaluate(() => (
        window.__investmentHoverChartCalls?.() || {draw: 0, update: 0}
    ))).toMatchObject({
        draw: expect.any(Number),
        update: 0,
    });
    await expect.poll(() => page.evaluate(() => (
        window.__investmentHoverChartCalls?.().draw || 0
    ))).toBeGreaterThan(0);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (
        window.__investmentHoverChartCalls?.().draw || 0
    ))).toBeLessThanOrEqual(2);
    await expect.poll(() => page.locator(
        '#investment_history tr[data-investment-history-row].is-metric-hover-target',
    ).first().evaluate((row) => getComputedStyle(row).animationName)).toBe('none');

    for (const range of ['3m', 'ytd', '1y', 'max']) {
        await page.locator(`label[for="investment_equity_range_${range}"]`).click();
        const readLastPoint = () => page.evaluate(() => {
            const canvas = document.querySelector('#investmentEquityChart');
            const chart = window.Chart?.getChart(canvas);
            const elements = chart?.getDatasetMeta(0)?.data || [];
            const element = elements[elements.length - 1];
            if (!canvas || !element) return null;
            const center = element.getCenterPoint();
            const rect = canvas.getBoundingClientRect();
            return {x: rect.left + center.x, y: rect.top + center.y};
        });
        await expect.poll(readLastPoint).not.toBeNull();
        const lastPoint = await readLastPoint();
        await page.mouse.move(lastPoint.x, lastPoint.y);
        await expect.poll(() => tooltip.locator('.chart-tooltip-label').evaluateAll((labels) => (
            labels.slice(-3).map((label) => label.textContent)
        ))).toEqual([
            'Realized P&L',
            'Unrealized P&L',
            'Cumulative P&L',
        ]);
    }
});

test('defers uncached 3M historical P&L replay until chart pointer movement settles', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-05-01', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 10, price: 100, amount: -1_000},
            {broker: 'ibkr', date: '2026-06-01', type: 'sell', ticker: 'QQQ', currency: 'USD', quantity: 2, price: 120, amount: 240},
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-05-01', close: 105},
                {date: '2026-06-01', close: 120},
                {date: '2026-07-01', close: 130},
                {date: '2026-08-01', close: 140},
            ],
        },
    });
    await page.goto('/trade/investment?view=overview&range=3m');
    await expect(page.locator('#investment_equity_range_3m')).toBeChecked();
    await expect.poll(() => page.evaluate(() => (
        window.Chart?.getChart(document.querySelector('#investmentEquityChart'))
            ?.getDatasetMeta(0)?.data?.length || 0
    ))).toBeGreaterThan(1);

    const initialState = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const element = chart?.getDatasetMeta(0)?.data?.[0];
        if (!chart || !element) return null;
        const nativeSetTimeout = window.setTimeout.bind(window);
        let pendingPnlCallback = null;
        window.setTimeout = (callback, delay, ...args) => {
            if (delay === 48 && typeof callback === 'function') {
                pendingPnlCallback = () => callback(...args);
                return 9_000_001;
            }
            return nativeSetTimeout(callback, delay, ...args);
        };
        window.__runPendingInvestmentPnl = () => {
            window.setTimeout = nativeSetTimeout;
            pendingPnlCallback?.();
        };
        const center = element.getCenterPoint();
        chart.setActiveElements([{datasetIndex: 0, index: 0}]);
        chart.tooltip?.setActiveElements(
            [{datasetIndex: 0, index: 0}],
            {x: center.x, y: center.y},
        );
        chart.update('none');
        const tooltip = document.querySelector('[data-investment-chart-tooltip="1"]');
        return {
            pnlState: tooltip?.dataset.investmentPnlState || '',
            pnlValues: Array.from(tooltip?.querySelectorAll(
                '[data-investment-tooltip-pnl] .chart-tooltip-value',
            ) || []).map((value) => value.textContent),
            hasPendingCallback: typeof pendingPnlCallback === 'function',
        };
    });
    expect(initialState).toEqual({
        pnlState: 'pending',
        pnlValues: ['--', '--', '--'],
        hasPendingCallback: true,
    });

    await page.evaluate(() => window.__runPendingInvestmentPnl?.());
    const tooltip = page.locator('[data-investment-chart-tooltip="1"]');
    await expect(tooltip).toHaveAttribute('data-investment-pnl-state', 'ready');
    const pnlValues = await tooltip.locator('[data-investment-tooltip-pnl] .chart-tooltip-value')
        .evaluateAll((values) => values.map((value) => Number(
            String(value.textContent || '').replace(/[^0-9.-]/g, ''),
        )));
    expect(pnlValues[2]).toBe(Number((pnlValues[0] + pnlValues[1]).toFixed(2)));
});

test('filters stock-details rows by currency, one day, or one calendar month while retaining closed-broker metrics', async ({page}) => {
    await page.addInitScript(() => {
        const RealDate = Date;
        const fixedTimestamp = new RealDate('2026-07-20T12:00:00Z').valueOf();
        class FixedDate extends RealDate {
            constructor(...args) {
                super(...(args.length ? args : [fixedTimestamp]));
            }

            static now() {
                return fixedTimestamp;
            }
        }
        window.Date = FixedDate;
    });
    const transactions = [
        {ledger_no: 1, broker: 'hsbc', date: '2026-07-10', type: 'buy', ticker: 'GOOGL', currency: 'HKD', quantity: 1, price: 340, amount: -340, commission: 0.11},
        {ledger_no: 2, broker: 'longbridge_hk', date: '2026-07-10', type: 'buy', ticker: 'GOOGL', currency: 'CNH', quantity: 1, price: 341, amount: -341, commission: 0.12},
        {ledger_no: 3, broker: 'hsbc', date: '2026-07-11', type: 'sell', ticker: 'GOOGL', currency: 'HKD', quantity: 1, price: 342, amount: 342, commission: 0.13},
        {ledger_no: 4, broker: 'longbridge_hk', date: '2026-07-11', type: 'sell', ticker: 'GOOGL', currency: 'CNH', quantity: 1, price: 343, amount: 343, commission: 0.14},
        {ledger_no: 5, broker: 'ibkr', date: '2026-07-12', type: 'buy', ticker: 'GOOGL', currency: 'USD', quantity: 1, price: 344, amount: -344, commission: 0.15},
        {ledger_no: 6, broker: 'ibkr', date: '2026-08-01', type: 'buy', ticker: 'GOOGL', currency: 'USD', quantity: 1, price: 345, amount: -345, commission: 0.16},
    ];
    await mockInvestmentReadApis(page, {
        transactions,
        brokers: ['ibkr', 'hsbc', 'longbridge_hk'],
        priceHistoryByTicker: {
            GOOGL: [
                {date: '2026-07-10', close: 340},
                {date: '2026-07-11', close: 343},
                {date: '2026-07-12', close: 344},
                {date: '2026-08-01', close: 345},
            ],
        },
    });
    await page.setViewportSize({width: 920, height: 720});
    await page.goto('/trade/investment?ticker=GOOGL#stock_panel');

    const stockTable = page.locator('#investment_stock_details_table_host');
    const detailRows = stockTable.locator('tr[data-investment-stock-detail-ledger]');
    await expect(detailRows).toHaveCount(6);

    const totalTradesCard = page.locator('.investment-stock-details-metric-card').filter({hasText: 'Total trades'});
    await expect(totalTradesCard).toContainText('HSBC');
    await expect(totalTradesCard).toContainText('Longbridge (HK)');
    const totalCommissionCard = page.locator('.investment-stock-details-metric-card').filter({hasText: 'Total commission'});
    await expect(totalCommissionCard).toContainText('HSBC');
    await expect(totalCommissionCard).toContainText('Longbridge (HK)');

    const currencyHeader = stockTable.locator('th[aria-label="Currency"]');
    await currencyHeader.hover();
    await currencyHeader.getByRole('button', {name: 'Currency filter: All'}).click();
    const currencyOptions = page.locator('[data-investment-currency-filter-dropdown] [data-investment-currency-filter-option]');
    await expect(currencyOptions).toHaveText(['All', 'CNH', 'HKD', 'USD']);
    await page.getByRole('option', {name: 'HKD'}).click();
    await expect(detailRows).toHaveCount(2);
    await expect(detailRows.locator('td:nth-child(6)')).toHaveText(['HKD', 'HKD']);

    await currencyHeader.hover();
    await currencyHeader.getByRole('button', {name: 'Currency filter: HKD'}).click();
    await page.getByRole('option', {name: 'All'}).click();
    await expect(detailRows).toHaveCount(6);

    const timeHeader = stockTable.locator('th[aria-label="Time"]');
    await timeHeader.hover();
    const timeFilterTrigger = timeHeader.getByRole('button', {name: 'Time filter: All dates'});
    await timeFilterTrigger.click();
    const datePanel = page.getByRole('dialog', {name: 'Transaction date filter'});
    await expect(datePanel.getByText('Start date', {exact: true})).toHaveCount(0);
    await expect(datePanel.getByText('End date', {exact: true})).toHaveCount(0);
    await expect(datePanel.getByText('Transaction date', {exact: true})).toHaveCount(0);
    await expect(datePanel.getByRole('textbox', {name: 'Transaction date'})).toHaveCount(1);
    const datePopover = page.locator('[data-date-popover]:not([hidden])');
    await expect(datePopover).toBeVisible();
    await expect.poll(() => timeFilterTrigger.evaluate((trigger) => {
        const rect = trigger.getBoundingClientRect();
        const hitTarget = document.elementFromPoint(
            rect.left + (rect.width / 2),
            rect.top + (rect.height / 2),
        );
        return hitTarget === trigger || trigger.contains(hitTarget);
    })).toBe(true);
    await timeFilterTrigger.click();
    await expect(datePanel).toBeHidden();
    await timeFilterTrigger.click();
    await expect(datePopover).toBeVisible();
    const feedback = page.locator('#investment_stock_details_date_start_feedback');
    await expect(feedback).toHaveText(
        'Choose a day, or select July 2026 for a whole month.',
    );
    const readDatePickerFrame = () => datePopover.evaluate((popover) => {
        const readRect = (element) => {
            const rect = element.getBoundingClientRect();
            return {
                bottom: rect.bottom,
                height: rect.height,
                left: rect.left,
                right: rect.right,
                top: rect.top,
                width: rect.width,
            };
        };
        const feedbackElement = popover.querySelector('[data-date-feedback]');
        const title = popover.querySelector('[data-date-title]');
        const previous = popover.querySelector('[data-date-nav="-1"]');
        const next = popover.querySelector('[data-date-nav="1"]');
        const feedbackStyle = getComputedStyle(feedbackElement);
        const popoverStyle = getComputedStyle(popover);
        return {
            backdropFilter: popoverStyle.backdropFilter,
            backgroundColor: popoverStyle.backgroundColor,
            feedbackColor: feedbackStyle.color,
            feedbackFontSize: feedbackStyle.fontSize,
            frame: readRect(popover),
            guidance: readRect(feedbackElement),
            next: readRect(next),
            previous: readRect(previous),
            title: readRect(title),
            titleColor: getComputedStyle(title).color,
            uiSmallFontSize: getComputedStyle(document.documentElement).getPropertyValue('--font-ui-sm').trim(),
        };
    });
    await page.waitForTimeout(300);
    const dayViewFrame = await readDatePickerFrame();
    expect(dayViewFrame.feedbackColor).toBe(dayViewFrame.titleColor);
    expect(dayViewFrame.feedbackFontSize).toBe(dayViewFrame.uiSmallFontSize);
    expect(dayViewFrame.backgroundColor).toMatch(/^rgb\(/);
    expect(dayViewFrame.backdropFilter).toBe('none');

    await page.locator('[data-date-popover]:not([hidden]) .date-picker-day[data-value="2026-07-10"]').click();
    await expect(datePopover).toBeVisible();
    await expect(detailRows).toHaveCount(2);
    await expect(timeHeader.getByRole('button', {name: 'Time filter: 10 Jul 2026'})).toBeVisible();
    await expect(feedback).toHaveText(
        '10 Jul 2026 selected. Choose another day, or select July 2026 for a whole month.',
    );

    await datePopover.locator('[data-date-title]').click();
    const monthGrid = datePopover.locator('[data-date-month-grid]:not([hidden])');
    await expect(monthGrid).toBeVisible();
    await expect(feedback).toHaveText('Choose a calendar month in 2026.');
    await page.waitForTimeout(300);
    const monthViewFrame = await readDatePickerFrame();
    for (const region of ['frame', 'guidance', 'previous', 'title', 'next']) {
        for (const edge of ['bottom', 'height', 'left', 'right', 'top', 'width']) {
            expect(
                Math.abs(monthViewFrame[region][edge] - dayViewFrame[region][edge]),
                `${region}.${edge} should remain stable between day and month views`,
            ).toBeLessThanOrEqual(0.5);
        }
    }
    await monthGrid.locator('[data-month-value="2026-07"]').click();
    await expect(datePopover).toBeVisible();
    await expect(monthGrid.locator('[data-month-value="2026-07"]')).toHaveClass(/is-selected/);
    await expect(detailRows).toHaveCount(5);
    await expect(timeHeader.getByRole('button', {name: 'Time filter: Jul 2026'})).toBeVisible();
    await expect(feedback).toHaveText('July 2026 selected. Choose another calendar month.');

    await page.getByRole('button', {name: 'Clear date filter'}).click();
    await expect(detailRows).toHaveCount(6);
});

test('leaves an average-price chart gap while a split-adjusted historical position is closed', async ({page}) => {
    const transactions = [
        // The price history is split-adjusted 20:1, while the imported 2023 buy is not.
        {ledger_no: 1, broker: 'ibkr', date: '2023-01-03', type: 'buy', ticker: 'GOOGL', currency: 'USD', quantity: 1, price: 2000, amount: -2000},
        {ledger_no: 2, broker: 'ibkr', date: '2023-02-03', type: 'sell', ticker: 'GOOGL', currency: 'USD', quantity: 20, price: 100, amount: 2000},
        // This unrelated transaction keeps the intermediate market-history date within the shared chart range.
        {ledger_no: 3, broker: 'ibkr', date: '2024-01-03', type: 'buy', ticker: 'MSFT', currency: 'USD', quantity: 1, price: 100, amount: -100},
        {ledger_no: 4, broker: 'ibkr', date: '2026-07-12', type: 'buy', ticker: 'GOOGL', currency: 'USD', quantity: 1, price: 344, amount: -344},
    ];
    await mockInvestmentReadApis(page, {
        transactions,
        priceHistoryByTicker: {
            GOOGL: [
                {date: '2023-01-03', close: 100},
                {date: '2023-02-03', close: 100},
                {date: '2024-01-03', close: 100},
                {date: '2026-07-12', close: 344},
            ],
        },
    });
    await page.setViewportSize({width: 920, height: 900});
    await page.goto('/trade/investment?ticker=GOOGL#stock_panel');
    await page.locator('label[for="investment_stock_details_range_max"]').click();

    await expect.poll(() => page.evaluate(() => {
        const canvas = document.querySelector('.investment-stock-details-price-chart-canvas');
        const chart = window.Chart?.getChart?.(canvas);
        const labels = chart?.data?.labels || [];
        const averagePrices = chart?.data?.datasets?.[1]?.data || [];
        const closedGapIndex = labels.indexOf('2024-01-03');
        return closedGapIndex >= 0 ? averagePrices[closedGapIndex] : undefined;
    })).toBeNull();
});

test('draws the exact-price horizontal hover guide across every stock-details range', async ({page}) => {
    const dailyHistory = Array.from({length: 566}, (_, index) => {
        const date = new Date(Date.UTC(2025, 0, 1 + index));
        const close = 100 + (index * 0.25);
        return {
            date: date.toISOString().slice(0, 10),
            close,
        };
    });
    const tradingDays = ['2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-20'];
    await mockInvestmentReadApis(page, {
        transactions: [
            {ledger_no: 1, broker: 'ibkr', date: '2025-01-02', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 10, price: 100, amount: -1000},
        ],
        tradingDays,
        priceHistoryByTicker: {QQQ: dailyHistory},
        intradayRows: (url) => String(url.searchParams.get('days') || '')
            .split(',')
            .filter(Boolean)
            .flatMap((day, dayIndex) => [
                {date: `${day} 09:30`, open: 200 + dayIndex, high: 201 + dayIndex, low: 199 + dayIndex, close: 200.25 + dayIndex},
                {date: `${day} 15:59`, open: 201 + dayIndex, high: 202 + dayIndex, low: 200 + dayIndex, close: 201.25 + dayIndex},
            ]),
    });
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment?ticker=QQQ#stock_panel');

    const canvas = page.locator('.investment-stock-details-price-chart-canvas');
    const ranges = ['1w', '3m', 'ytd', '1y', 'max', 'auto'];
    for (const range of ranges) {
        await canvas.evaluate((element) => {
            const chart = element._investmentStockDetailsChart;
            if (chart) chart._e2ePreviousRangeChart = true;
        });
        await page.locator(`label[for="investment_stock_details_range_${range}"]`).click();
        await expect(page.locator(`#investment_stock_details_range_${range}`)).toBeChecked();
        await expect.poll(() => canvas.evaluate((element) => {
            const chart = element._investmentStockDetailsChart;
            return Boolean(
                chart?.chartArea
                && chart?.data?.labels?.length
                && !chart._e2ePreviousRangeChart
            );
        }), {timeout: 30_000}).toBe(true);
        const hoverPoint = await canvas.evaluate((element) => {
            const chart = element._investmentStockDetailsChart;
            const rect = element.getBoundingClientRect();
            return {
                x: rect.left + ((chart.chartArea.left + chart.chartArea.right) / 2),
                y: rect.top + ((chart.chartArea.top + chart.chartArea.bottom) / 2),
            };
        });
        await page.mouse.move(hoverPoint.x, hoverPoint.y);
        await expect.poll(() => canvas.evaluate((element) => (
            element._investmentStockDetailsChart?._activeInvestmentStockDetailsGuideBounds?.formattedPrice || ''
        ))).toMatch(/^-?\d{1,3}(?:,\d{3})*\.\d{2,}$/);

        await expect.poll(() => canvas.evaluate((element, injectFractionalTick) => {
            const chart = element._investmentStockDetailsChart;
            const initialBounds = chart?._activeInvestmentStockDetailsGuideBounds;
            const yScale = chart?.scales?.y;
            if (
                !chart
                || !initialBounds
                || !Array.isArray(yScale?._labelItems)
            ) return null;
            const hoverPlugin = chart.config.plugins.find((plugin) => plugin.id === 'investmentStockDetailsHoverGuidePlugin');
            const sourceAxisLabelItem = yScale._labelItems
                .find((item) => String(item?.label ?? '').trim());
            const syntheticFractionalLabelItem = injectFractionalTick && sourceAxisLabelItem
                ? {...sourceAxisLabelItem, label: '19.21'}
                : null;
            if (syntheticFractionalLabelItem) {
                yScale._labelItems.push(syntheticFractionalLabelItem);
                hoverPlugin.afterDatasetsDraw(chart);
            }
            const bounds = chart._activeInvestmentStockDetailsGuideBounds;
            const visibleAxisLabelItems = yScale._labelItems
                .filter((item) => String(item?.label ?? '').trim());
            const axisLabelItem = visibleAxisLabelItems
                .find((item) => String(item?.label ?? '').includes('.'))
                || visibleAxisLabelItems[0];
            const axisLabelOptions = axisLabelItem.options;
            const axisTickCopy = String(axisLabelItem.label);
            const context = element.getContext('2d');
            context.save();
            context.font = axisLabelItem.font.string;
            const axisTickWidth = context.measureText(axisTickCopy).width;
            const axisLabelTranslationX = Number(axisLabelOptions.translation[0]);
            const axisTextAlign = String(axisLabelOptions.textAlign || 'right');
            const expectedAxisLabelRight = axisLabelTranslationX + (
                axisTextAlign === 'center'
                    ? axisTickWidth / 2
                    : (axisTextAlign === 'left' || axisTextAlign === 'start' ? axisTickWidth : 0)
            );
            const axisTickDecimalIndex = axisTickCopy.lastIndexOf('.');
            const axisFractionCopy = axisTickDecimalIndex >= 0
                ? axisTickCopy.slice(axisTickDecimalIndex)
                : '';
            const expectedDecimalAnchor = expectedAxisLabelRight - context.measureText(axisFractionCopy).width;
            context.restore();
            const result = {
                axisAnchorDelta: Math.abs(bounds.decimalAnchor - expectedDecimalAnchor),
                axisLabelRightDelta: Math.abs(bounds.axisLabelRight - expectedAxisLabelRight),
                axisTickHasFraction: axisTickDecimalIndex >= 0,
                badgeCoversAxis: bounds.badgeLeft < chart.chartArea.left && bounds.badgeRight > chart.chartArea.left - 4,
                exactPriceDelta: Math.abs(bounds.price - chart.scales.y.getValueForPixel(bounds.y)),
                hasLayeredHooks: typeof hoverPlugin?.beforeDatasetsDraw === 'function'
                    && typeof hoverPlugin?.afterDatasetsDraw === 'function',
                leftDelta: Math.abs(bounds.left - chart.chartArea.left),
                rightDelta: Math.abs(bounds.right - chart.chartArea.right),
                yWithinPlot: bounds.y >= chart.chartArea.top && bounds.y <= chart.chartArea.bottom,
            };
            if (syntheticFractionalLabelItem) yScale._labelItems.pop();
            return result;
        }, range === '1w')).toEqual({
            axisAnchorDelta: 0,
            axisLabelRightDelta: 0,
            axisTickHasFraction: range === '1w',
            badgeCoversAxis: true,
            exactPriceDelta: 0,
            hasLayeredHooks: true,
            leftDelta: 0,
            rightDelta: 0,
            yWithinPlot: true,
        });
    }
});

test('keeps stock details as the only visible transaction table and preserves exact row hover', async ({page}) => {
    const transactions = Array.from({length: 20}, (_, index) => ({
        ledger_no: 7000 + index,
        broker: 'ibkr',
        date: `2026-06-${String(index + 1).padStart(2, '0')}`,
        type: 'buy',
        ticker: index % 2 === 0 ? 'DRAM' : 'MSFT',
        currency: 'USD',
        quantity: 1,
        price: 50 + index,
        amount: -(50 + index),
    }));
    await mockInvestmentReadApis(page, {transactions});
    await page.setViewportSize({width: 920, height: 900});
    await page.goto('/trade/investment?ticker=DRAM#stock_panel');
    await expect(page.locator('#investment_stock_details_table_host')).toBeVisible();
    await expect(page.locator('tr[data-investment-stock-detail-ledger]')).toHaveCount(10);
    const stockDates = await page.locator('tr[data-investment-stock-detail-ledger]').evaluateAll((rows) => (
        rows.map((row) => Date.parse(row.cells.item(2)?.textContent?.trim() || ''))
    ));
    expect(stockDates).toEqual([...stockDates].sort((left, right) => right - left));
    await expect(page.locator('#history_table_wrap')).toBeHidden();
    await expect(page.locator('#investment_history_surface .investment-history-table-shell:visible')).toHaveCount(1);
    await expect(page.locator('#investment_history_pagination')).toBeHidden();

    const upperLedger = page.locator('tr[data-investment-stock-detail-ledger]').first();
    await expect(upperLedger).toHaveAttribute('data-stock-history-bound', '1');
    await upperLedger.hover();
    await expect(upperLedger).toHaveClass(/is-metric-hover-active/);
});

test('preserves history filters, page, and scroll while binding an internal transfer', async ({page}) => {
    const newerHsbcRows = Array.from({length: 104}, (_, index) => ({
        ledger_no: 8_100 + index,
        broker: 'hsbc',
        date: `2025-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
        type: 'credit_interest',
        currency: 'USD',
        amount: 1,
        description: `HSBC interest ${index + 1}`,
    }));
    const olderHsbcRows = Array.from({length: 10}, (_, index) => ({
        ledger_no: 7_900 + index,
        broker: 'hsbc',
        date: `2024-10-${String(index + 1).padStart(2, '0')}`,
        type: 'credit_interest',
        currency: 'USD',
        amount: 1,
        description: `Earlier HSBC interest ${index + 1}`,
    }));
    const transferSource = {
        ledger_no: 8_000,
        broker: 'hsbc',
        date: '2024-11-27',
        type: 'deposit',
        currency: 'USD',
        amount: 3_400,
        description: '9285883 R00460',
        source: {reference_id: '9285883 R00460'},
    };
    const transferTarget = {
        ledger_no: 7_999,
        broker: 'ibkr',
        date: '2024-11-27',
        type: 'withdrawal',
        currency: 'USD',
        amount: -3_400,
        description: 'IBKR transfer outflow',
        source: {reference_id: 'IBKR transfer outflow'},
    };
    await mockInvestmentReadApis(page, {
        transactions: [...olderHsbcRows, transferTarget, transferSource, ...newerHsbcRows],
    });
    let persistedBindingRequest = null;
    await page.route('**/api/investment/internal-transfer-binding', async (route) => {
        persistedBindingRequest = route.request().postDataJSON();
        await new Promise((resolve) => setTimeout(resolve, 250));
        await route.fulfill({contentType: 'application/json', body: JSON.stringify({success: true})});
    });
    await page.setViewportSize({width: 889, height: 1_116});
    await page.goto('/trade/investment');

    const bindingAlert = page.locator(
        '#history_table_wrap [data-investment-description-binding-alert]',
    );
    await expect(bindingAlert).toHaveCount(1);
    await expect(bindingAlert).toHaveCSS('inset-block-start', '2px');
    const descriptionHeaderBox = await page.locator(
        '#history_table_wrap th[data-markdown-export-label="Description"]',
    ).boundingBox();
    const bindingAlertBox = await bindingAlert.boundingBox();
    expect(descriptionHeaderBox).not.toBeNull();
    expect(bindingAlertBox).not.toBeNull();
    expect(bindingAlertBox.y).toBeLessThan(descriptionHeaderBox.y + (descriptionHeaderBox.height / 2));
    expect(bindingAlertBox.x + bindingAlertBox.width).toBeGreaterThan(descriptionHeaderBox.x + descriptionHeaderBox.width - 20);
    await bindingAlert.hover();
    const bindingAlertTooltip = page.locator(
        '[data-investment-description-binding-alert-tooltip], .investment-description-binding-alert-tooltip',
    );
    await expect(bindingAlertTooltip.locator('.settings-service-name')).toHaveText('Unbound internal transfer');
    await expect(bindingAlertTooltip.locator('.settings-service-note')).toHaveText(
        'Choose the matching transfer counterpart in the Description cell to keep cash flow and aggregate equity accurate.',
    );
    await expect(bindingAlertTooltip.locator('.investment-description-binding-alert-tooltip-logo')).toBeVisible();
    const tooltipLayout = await bindingAlertTooltip.evaluate((tooltip) => {
        const logo = tooltip.querySelector('.investment-description-binding-alert-tooltip-logo')?.getBoundingClientRect();
        const title = tooltip.querySelector('.settings-service-name')?.getBoundingClientRect();
        const note = tooltip.querySelector('.settings-service-note')?.getBoundingClientRect();
        return {
            logoTitleCenterDelta: logo && title
                ? Math.abs((logo.top + (logo.height / 2)) - (title.top + (title.height / 2)))
                : Number.POSITIVE_INFINITY,
            titleNoteLeftDelta: title && note ? Math.abs(title.left - note.left) : Number.POSITIVE_INFINITY,
        };
    });
    expect(tooltipLayout.logoTitleCenterDelta).toBeLessThan(1.5);
    expect(tooltipLayout.titleNoteLeftDelta).toBeLessThan(1.5);
    await expect(bindingAlertTooltip).toHaveClass(/is-visible/);

    const brokerScopeTrigger = page.locator('#history_table_wrap [data-investment-broker-filter-trigger]');
    await brokerScopeTrigger.click();
    await page.getByRole('option', {name: 'HSBC', exact: true}).click();
    await expect(brokerScopeTrigger).toHaveAttribute('aria-label', 'Broker filter: IBKR');
    await expect(page.locator('#history_table_wrap [data-investment-description-binding-alert]')).toHaveCount(0);
    await expect(page.locator('#history_table_wrap th[data-markdown-export-label="Description"]')).toHaveText('Description');
    await page.goto('/trade/investment');

    const descriptionFilterTrigger = page.locator(
        '#history_table_wrap [data-investment-description-filter-trigger]',
    );
    await expect(descriptionFilterTrigger).toHaveCount(1);
    await expect(descriptionFilterTrigger).toHaveAttribute('aria-label', 'Description filter: All');
    await descriptionFilterTrigger.click({force: true});
    const descriptionFilterDropdown = page.locator(
        '[data-investment-description-filter-dropdown]:not([hidden])',
    );
    const unboundDescriptionOption = descriptionFilterDropdown.locator(
        '[data-investment-description-filter-option="unbound"]',
    );
    await expect(descriptionFilterDropdown.locator('[data-investment-description-filter-option]')).toHaveCount(2);
    await expect(unboundDescriptionOption).toContainText('Unbound');
    await expect(unboundDescriptionOption.locator('.investment-unbound-filter-pill')).toHaveCSS(
        'border-radius',
        '10px',
    );
    await unboundDescriptionOption.click();
    await expect(page.locator('#investment_history tr[data-investment-history-row]')).toHaveCount(1);
    await descriptionFilterTrigger.click({force: true});
    await descriptionFilterDropdown.locator('[data-investment-description-filter-option="all"]').click();

    const brokerTrigger = page.locator('#history_table_wrap [data-investment-broker-filter-trigger]');
    await expect(brokerTrigger).toHaveAttribute('aria-label', 'Broker filter: All brokers');
    await brokerTrigger.click();
    await page.getByRole('option', {name: 'IBKR', exact: true}).click();
    await expect(brokerTrigger).toHaveAttribute('aria-label', 'Broker filter: HSBC');

    await page.locator('[data-investment-history-page-target="2"]').click();
    await expect(page.locator('[data-investment-history-page-target="2"]')).toHaveAttribute('aria-current', 'page');
    const historyScroll = page.locator('#history_table_wrap .investment-history-table-scroll');
    await historyScroll.evaluate((element) => { element.scrollTop = 96; });
    const scrollBefore = await historyScroll.evaluate((element) => element.scrollTop);

    const bindingSelect = historyScroll.locator(
        '#investment_history select[data-investment-transfer-source-key]'
    );
    await expect(bindingSelect).toHaveCount(1);
    await expect(bindingSelect).toHaveCSS('border-color', 'rgb(255, 47, 146)');
    await expect(bindingSelect).toHaveCSS('border-width', '1px');
    await expect(bindingSelect).toHaveCSS('border-radius', '10px');
    await expect(bindingSelect.locator('..')).not.toHaveCSS('border-color', 'rgb(255, 47, 146)');
    await expect(bindingSelect.locator('..')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(bindingSelect.locator('..')).toHaveCSS('border-radius', '10px');
    const bindingTarget = await bindingSelect.locator('option').evaluateAll((options) => (
        options.map((option) => option.value).find(Boolean)
    ));
    await bindingSelect.selectOption(bindingTarget);

    const bindingModal = page.locator('#workspace_modal_overlay');
    await expect(bindingModal).toBeVisible();
    await expect(bindingModal.locator('.workspace-modal-title')).toHaveText('Binding internal transfer');
    await expect(bindingModal.locator('.workspace-modal-copy')).toContainText('may take up to 10 seconds');
    await expect(bindingModal.locator('#workspace_modal_overlay_icon')).toHaveClass(/suggestion-loading-spinner/);

    await expect(brokerTrigger).toHaveAttribute('aria-label', 'Broker filter: HSBC');
    await expect(page.locator('[data-investment-history-page-target="2"]')).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => historyScroll.evaluate((element) => element.scrollTop)).toBe(scrollBefore);
    await expect.poll(() => persistedBindingRequest).toEqual({
        source_key: expect.stringMatching(/^v2:/),
        target_key: expect.stringMatching(/^v2:/),
    });
    await expect(bindingModal).toBeHidden();
});

test('can ignore and restore a false-positive internal-transfer candidate', async ({page}) => {
    const transferSource = {
        ledger_no: 5_108,
        broker: 'hsbc',
        date: '2025-03-24',
        type: 'deposit',
        currency: 'HKD',
        amount: 2_500,
        description: 'AIRWALLEX duplicate deposit',
    };
    const transferTarget = {
        ledger_no: 5_116,
        broker: 'boc_hk',
        date: '2025-03-25',
        type: 'withdrawal',
        currency: 'HKD',
        amount: -2_500,
        description: 'BOCHK transfer outflow',
    };
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'boc_hk'],
        transactions: [transferTarget, transferSource],
    });
    const persistedRequests = [];
    let ignoredSourceKeys = [];
    await page.route('**/api/investment/internal-transfer-binding', async (route) => {
        const request = route.request().postDataJSON();
        persistedRequests.push(request);
        if (request.action === 'ignore') {
            ignoredSourceKeys = [request.source_key];
        } else if (request.action === 'restore') {
            ignoredSourceKeys = [];
        }
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                manual_internal_transfer_bindings: {},
                manual_internal_transfer_ignored_source_keys: ignoredSourceKeys,
            }),
        });
    });

    await page.goto('/trade/investment');
    const sourceRow = page.locator('#investment_history tr').filter({hasText: 'AIRWALLEX duplicate deposit'}).first();
    const bindingSelect = sourceRow.locator('select[data-investment-transfer-source-key]');
    await expect(bindingSelect).toHaveCount(1);
    await expect(bindingSelect.locator('option').filter({hasText: 'Incorrectly identified, ignore'})).toHaveCount(1);

    await bindingSelect.selectOption({label: 'Incorrectly identified, ignore'});
    await expect.poll(() => persistedRequests.at(-1)?.action).toBe('ignore');
    expect(persistedRequests.at(-1)).toEqual({
        source_key: expect.stringMatching(/^v2:/),
        target_key: '',
        action: 'ignore',
    });
    await expect(bindingSelect).toHaveValue('__ignore__');
    await expect(bindingSelect.locator('option:checked')).toHaveText('Incorrectly identified, ignore');

    await bindingSelect.selectOption({label: 'Restore binding review'});
    await expect.poll(() => persistedRequests.at(-1)?.action).toBe('restore');
    expect(persistedRequests.at(-1)).toEqual({
        source_key: expect.stringMatching(/^v2:/),
        target_key: '',
        action: 'restore',
    });
    await expect(bindingSelect).toHaveValue('');
    await expect(bindingSelect.locator('option:checked')).toHaveText('Bind transfer outflow...');
});

test('offers a BOCHK withdrawal for a Longbridge HK deposit after an HSBC to BOCHK binding', async ({page}) => {
    const hsbcDeposit = {
        ledger_no: 5_100,
        broker: 'hsbc',
        account: '000-999999-999',
        date: '2025-05-15',
        type: 'deposit',
        currency: 'HKD',
        amount: 12.97,
        description: 'WeChat Pay HK',
    };
    const hsbcWithdrawal = {
        ledger_no: 5_101,
        broker: 'hsbc',
        account: '000-999999-999',
        date: '2025-05-15',
        type: 'withdrawal',
        currency: 'HKD',
        amount: -12.97,
        description: 'Transfer to BOCHK',
    };
    const bochkDeposit = {
        ledger_no: 5_102,
        broker: 'boc_hk',
        account: '65640001',
        date: '2025-05-15',
        type: 'deposit',
        currency: 'HKD',
        amount: 12.97,
        description: 'From HSBC',
    };
    const bochkWithdrawal = {
        ledger_no: 5_103,
        broker: 'boc_hk',
        account: '65640001',
        date: '2025-05-15',
        type: 'withdrawal',
        currency: 'HKD',
        amount: -12.97,
        description: 'Transfer to Longbridge HK',
    };
    const longbridgeDeposit = {
        ledger_no: 5_104,
        broker: 'longbridge_hk',
        account: 'H99999999',
        date: '2025-05-15',
        type: 'deposit',
        currency: 'HKD',
        amount: 12.97,
        description: 'From BOCHK',
    };
    const key = (broker, account, type, amount) => `v2:${JSON.stringify([
        broker,
        account,
        '2025-05-15',
        type,
        'HKD',
        amount,
    ])}`;
    const hsbcDepositKey = key('hsbc', '000-999999-999', 'deposit', '12.97');
    const hsbcWithdrawalKey = key('hsbc', '000-999999-999', 'withdrawal', '-12.97');
    const bochkDepositKey = key('boc_hk', '65640001', 'deposit', '12.97');
    const bochkWithdrawalKey = key('boc_hk', '65640001', 'withdrawal', '-12.97');

    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'boc_hk', 'longbridge_hk'],
        transactions: [
            hsbcDeposit,
            hsbcWithdrawal,
            bochkDeposit,
            bochkWithdrawal,
            longbridgeDeposit,
        ],
        manualInternalTransferBindings: {[bochkDepositKey]: hsbcWithdrawalKey},
        manualInternalTransferIgnoredSourceKeys: [hsbcDepositKey],
    });

    await page.goto('/trade/investment');

    const longbridgeRow = page.locator('#investment_history tr').filter({hasText: 'From BOCHK'}).first();
    const bindingSelect = longbridgeRow.locator('select[data-investment-transfer-source-key]');
    await expect(bindingSelect).toHaveCount(1);
    const optionValues = await bindingSelect.locator('option').evaluateAll((options) => (
        options.map((option) => option.value)
    ));
    expect(optionValues).toContain(bochkWithdrawalKey);
    expect(optionValues).not.toContain(hsbcWithdrawalKey);
    await expect(bindingSelect.locator('option').filter({hasText: 'Bank of China (Hong Kong)'})).toHaveCount(1);
    await expect(bindingSelect).toHaveValue('');
    await expect(longbridgeRow).toContainText('Bind transfer outflow...');
});

test('binds the July 2025 Longbridge HK USD deposit to the BOCHK withdrawal', async ({page}) => {
    const hsbcWithdrawal = {
        ledger_no: 5_401,
        broker: 'hsbc',
        account: '000-999999-999',
        date: '2025-07-14',
        type: 'withdrawal',
        currency: 'USD',
        amount: -4.93,
        description: 'HK526893PI145183',
    };
    const bochkDeposit = {
        ledger_no: 5_402,
        broker: 'boc_hk',
        account: '65640001',
        date: '2025-07-14',
        type: 'deposit',
        currency: 'USD',
        amount: 4.93,
        description: 'Transfer CHATS73609393BKRB5019',
    };
    const bochkWithdrawal = {
        ledger_no: 5_403,
        broker: 'boc_hk',
        account: '65640001',
        date: '2025-07-14',
        type: 'withdrawal',
        currency: 'USD',
        amount: -4.94,
        description: 'Transfer E-BANKING TRANSFER',
    };
    const longbridgeDeposit = {
        ledger_no: 5_353,
        broker: 'longbridge_hk',
        account: 'H99999999',
        date: '2025-07-14',
        type: 'deposit',
        currency: 'USD',
        amount: 4.94,
        description: 'Deposit Cash',
    };
    const key = (broker, account, type, amount) => `v2:${JSON.stringify([
        broker,
        account,
        '2025-07-14',
        type,
        'USD',
        amount,
    ])}`;
    const hsbcWithdrawalKey = key('hsbc', '000-999999-999', 'withdrawal', '-4.93');
    const bochkDepositKey = key('boc_hk', '65640001', 'deposit', '4.93');
    const bochkWithdrawalKey = key('boc_hk', '65640001', 'withdrawal', '-4.94');
    const longbridgeDepositKey = key('longbridge_hk', 'H99999999', 'deposit', '4.94');
    const existingBindings = {[bochkDepositKey]: hsbcWithdrawalKey};
    let persistedBindingRequest = null;

    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'boc_hk', 'longbridge_hk'],
        transactions: [hsbcWithdrawal, bochkDeposit, bochkWithdrawal, longbridgeDeposit],
        manualInternalTransferBindings: existingBindings,
    });
    await page.route('**/api/investment/internal-transfer-binding', async (route) => {
        persistedBindingRequest = route.request().postDataJSON();
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                manual_internal_transfer_bindings: {
                    ...existingBindings,
                    [persistedBindingRequest.source_key]: persistedBindingRequest.target_key,
                },
            }),
        });
    });

    await page.goto('/trade/investment');

    const longbridgeRow = page.locator('#investment_history tr').filter({hasText: 'Deposit Cash'}).first();
    const bindingSelect = longbridgeRow.locator('select[data-investment-transfer-source-key]');
    await expect(bindingSelect).toHaveCount(1);
    await expect(bindingSelect.locator('option').filter({hasText: 'Bank of China (Hong Kong)'})).toHaveCount(1);
    await expect(bindingSelect).toContainText('-4.94');
    await bindingSelect.selectOption(bochkWithdrawalKey);

    await expect.poll(() => persistedBindingRequest).toEqual({
        source_key: longbridgeDepositKey,
        target_key: bochkWithdrawalKey,
    });
    await expect(page.locator('#investment_import_feedback')).toContainText(
        'Linked the selected internal-transfer counterpart.',
    );
    await expect.poll(() => page.locator(
        '#investment_history select[data-investment-transfer-source-key]',
    ).evaluateAll((selects, expected) => selects.some((select) => (
        select.dataset.investmentTransferSourceKey === expected.sourceKey
        && select.value === expected.targetKey
    )), {
        sourceKey: longbridgeDepositKey,
        targetKey: bochkWithdrawalKey,
    })).toBe(true);
});

test('binds the March 2023 Longbridge HK USD deposit after a BOCHK transfer fee', async ({page}) => {
    const bochkDeposit = {
        broker: 'boc_hk',
        account: '65640001',
        date: '2023-03-29',
        type: 'deposit',
        currency: 'USD',
        amount: 1_633.44,
        description: 'Clearing Cheque I-BANK-TEST-CHEQUE-001',
    };
    const bochkWithdrawal = {
        broker: 'boc_hk',
        account: '65640001',
        date: '2023-03-30',
        type: 'withdrawal',
        currency: 'USD',
        amount: -1_633.44,
        description: 'Transfer EXPRESS TRF.(RTGS/CHATS)',
    };
    const longbridgeDeposit = {
        broker: 'longbridge_hk',
        account: 'H99999999',
        date: '2023-03-31',
        type: 'deposit',
        currency: 'USD',
        amount: 1_632.14,
        description: 'Deposit Cash',
    };
    const key = (broker, account, transactionDate, type, amount) => `v2:${JSON.stringify([
        broker,
        account,
        transactionDate,
        type,
        'USD',
        amount,
    ])}`;
    const bochkWithdrawalKey = key('boc_hk', '65640001', '2023-03-30', 'withdrawal', '-1633.44');
    const longbridgeDepositKey = key('longbridge_hk', 'H99999999', '2023-03-31', 'deposit', '1632.14');
    const existingBindings = {};
    let persistedBindingRequest = null;

    await mockInvestmentReadApis(page, {
        brokers: ['boc_hk', 'longbridge_hk'],
        transactions: [bochkDeposit, bochkWithdrawal, longbridgeDeposit],
        manualInternalTransferBindings: existingBindings,
    });
    await page.route('**/api/investment/internal-transfer-binding', async (route) => {
        persistedBindingRequest = route.request().postDataJSON();
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                manual_internal_transfer_bindings: {
                    ...existingBindings,
                    [persistedBindingRequest.source_key]: persistedBindingRequest.target_key,
                },
            }),
        });
    });

    await page.goto('/trade/investment');

    const longbridgeRow = page.locator('#investment_history tr').filter({hasText: 'Deposit Cash'}).first();
    const bindingSelect = longbridgeRow.locator('select[data-investment-transfer-source-key]');
    await expect(bindingSelect).toHaveCount(1);
    await expect(bindingSelect.locator('option').filter({hasText: 'Bank of China (Hong Kong)'})).toHaveCount(1);
    await expect(bindingSelect.locator('option').filter({hasText: 'includes USD 1.30 transfer fee'})).toHaveCount(1);
    await bindingSelect.selectOption(bochkWithdrawalKey);

    await expect.poll(() => persistedBindingRequest).toEqual({
        source_key: longbridgeDepositKey,
        target_key: bochkWithdrawalKey,
    });
    await expect(page.locator('#investment_import_feedback')).toContainText(
        'Linked the selected internal-transfer counterpart.',
    );
    await expect.poll(() => page.locator(
        '#investment_history select[data-investment-transfer-source-key]',
    ).evaluateAll((selects, expected) => selects.some((select) => (
        select.dataset.investmentTransferSourceKey === expected.sourceKey
        && select.value === expected.targetKey
    )), {
        sourceKey: longbridgeDepositKey,
        targetKey: bochkWithdrawalKey,
    })).toBe(true);
});

test('does not offer a negative Longbridge HK cash reversal as a transfer source', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['boc_hk', 'longbridge_hk'],
        transactions: [
            {
                broker: 'longbridge_hk',
                account: 'H99999999',
                date: '2024-04-17',
                type: 'deposit',
                currency: 'USD',
                amount: -43.87,
                description: 'RETURNED CHEQUE INT. DATE 2024/04/15',
            },
            {
                broker: 'boc_hk',
                account: '65640001',
                date: '2024-04-16',
                type: 'withdrawal',
                currency: 'USD',
                amount: -43.87,
                description: 'Transfer Transaction AUTO-SWEEP',
            },
        ],
    });

    await page.goto('/trade/investment');

    const reversalRow = page.locator('#investment_history tr').filter({hasText: 'RETURNED CHEQUE'}).first();
    await expect(reversalRow).toHaveCount(1);
    await expect(reversalRow.locator('select[data-investment-transfer-source-key]')).toHaveCount(0);
});

test('offers a BOCHK withdrawal for an IBKR CNH deposit', async ({page}) => {
    const bochkWithdrawal = {
        ledger_no: 6_101,
        broker: 'boc_hk',
        account: '65640001',
        date: '2026-06-19',
        type: 'withdrawal',
        currency: 'CNH',
        amount: -7_500,
        description: 'Transfer FPS/Interactive Brokers LLC',
    };
    const ibkrDeposit = {
        ledger_no: 6_102,
        broker: 'ibkr',
        account: 'U00000001',
        date: '2026-06-19',
        type: 'deposit',
        currency: 'CNH',
        amount: 7_500,
        description: 'Electronic Fund Transfer',
    };
    const key = (broker, account, type, amount) => `v2:${JSON.stringify([
        broker,
        account,
        '2026-06-19',
        type,
        'CNH',
        amount,
    ])}`;
    const bochkWithdrawalKey = key('boc_hk', '65640001', 'withdrawal', '-7500');

    await mockInvestmentReadApis(page, {
        brokers: ['boc_hk', 'ibkr'],
        transactions: [bochkWithdrawal, ibkrDeposit],
    });

    await page.goto('/trade/investment');

    const ibkrRow = page.locator('#investment_history tr').filter({hasText: 'Electronic Fund Transfer'}).first();
    const bindingSelect = ibkrRow.locator('select[data-investment-transfer-source-key]');
    await expect(bindingSelect).toHaveCount(1);
    await expect(bindingSelect.locator('option').filter({hasText: 'Bank of China (Hong Kong)'})).toHaveCount(1);
    await expect(bindingSelect).toContainText('-CNH 7,500');
    const optionValues = await bindingSelect.locator('option').evaluateAll((options) => (
        options.map((option) => option.value)
    ));
    expect(optionValues).toContain(bochkWithdrawalKey);
    await expect(bindingSelect).toHaveValue('');
});

test('offers a CNH withdrawal for an IBKR equivalent-USD deposit using the daily FX rate', async ({page}) => {
    const matchingBochkWithdrawal = {
        ledger_no: 6_201,
        broker: 'boc_hk',
        account: '65640001',
        date: '2026-06-19',
        type: 'withdrawal',
        currency: 'CNH',
        amount: -20_000,
        description: 'Transfer FPS/Interactive Brokers LLC',
    };
    const unrelatedBochkWithdrawal = {
        ledger_no: 6_202,
        broker: 'boc_hk',
        account: '65640001',
        date: '2026-06-19',
        type: 'withdrawal',
        currency: 'CNH',
        amount: -7_500,
        description: 'Transfer FPS/Interactive Brokers LLC',
    };
    const ibkrEquivalentDeposit = {
        ledger_no: 6_203,
        broker: 'ibkr',
        account: 'U00000001',
        date: '2026-06-19',
        type: 'deposit',
        amount: 2_948.2,
        description: 'Electronic Fund Transfer',
        source: {file_kind: 'transactions', row_number: 130},
    };

    await mockInvestmentReadApis(page, {
        brokers: ['boc_hk', 'ibkr'],
        transactions: [matchingBochkWithdrawal, unrelatedBochkWithdrawal, ibkrEquivalentDeposit],
        fxRateHistoryByCurrency: {
            CNY: {
                dates: ['2026-06-19'],
                values: {'2026-06-19': 6.7830},
            },
        },
    });

    await page.goto('/trade/investment');

    const ibkrRow = page.locator('#investment_history tr').filter({hasText: 'Electronic Fund Transfer'}).first();
    const bindingSelect = ibkrRow.locator('select[data-investment-transfer-source-key]');
    await expect(bindingSelect).toHaveCount(1);
    await expect(bindingSelect.locator('option').filter({hasText: 'Bank of China (Hong Kong)'})).toHaveCount(1);
    await expect(bindingSelect).toContainText('-CNH 20,000');
    await expect(bindingSelect).toContainText('≈ USD 2,948');
    await expect(bindingSelect).toContainText('@ 6.7830');
    const optionValues = await bindingSelect.locator('option').evaluateAll((options) => (
        options.map((option) => option.value)
    ));
    expect(optionValues.some((value) => value.includes('boc_hk'))).toBe(true);
    await expect(bindingSelect).toHaveValue('');
});

test('offers the matching BOCHK withdrawal for the February 2025 Longbridge HK deposit', async ({page}) => {
    const bochkWithdrawal = {
        ledger_no: 5_201,
        broker: 'boc_hk',
        account: '65640001',
        date: '2025-02-24',
        type: 'withdrawal',
        currency: 'HKD',
        amount: -628.71,
        description: 'Transfer FPS DD/LONG BRIDGE HK LTD',
    };
    const longbridgeDeposit = {
        ledger_no: 5_202,
        broker: 'longbridge_hk',
        account: 'H99999999',
        date: '2025-02-24',
        type: 'deposit',
        currency: 'HKD',
        amount: 628.71,
        description: 'Deposit Cash',
    };
    await mockInvestmentReadApis(page, {
        brokers: ['boc_hk', 'longbridge_hk'],
        transactions: [bochkWithdrawal, longbridgeDeposit],
    });

    await page.goto('/trade/investment');

    const longbridgeRow = page.locator('#investment_history tr').filter({hasText: 'Deposit Cash'}).first();
    const bindingSelect = longbridgeRow.locator('select[data-investment-transfer-source-key]');
    await expect(bindingSelect).toHaveCount(1);
    await expect(bindingSelect.locator('option').filter({hasText: 'Bank of China (Hong Kong)'})).toHaveCount(1);
    await expect(bindingSelect).toContainText('-HKD 628.71');
});

test('offers the matching Longbridge HK withdrawal for a BOCHK deposit', async ({page}) => {
    const hsbcDeposit = {
        ledger_no: 5_301,
        broker: 'hsbc',
        account: '000-999999-999',
        date: '2026-07-16',
        type: 'deposit',
        currency: 'HKD',
        amount: 500,
        description: 'DEMO ACCOUNT HOLDER REF00000000000000 16JUL',
    };
    const bochkWithdrawal = {
        ledger_no: 5_302,
        broker: 'boc_hk',
        account: '65640001',
        date: '2026-07-16',
        type: 'withdrawal',
        currency: 'HKD',
        amount: -500,
        description: 'Transfer FPS/DEMO ACCOUNT HOLDER/12260716F763864594',
    };
    const bochkDeposit = {
        ledger_no: 5_303,
        broker: 'boc_hk',
        account: '65640001',
        date: '2026-07-16',
        type: 'deposit',
        currency: 'HKD',
        amount: 500,
        description: 'Transfer Transaction CBS TRANSFER(2915450572044)',
    };
    const longbridgeWithdrawal = {
        ledger_no: 5_304,
        broker: 'longbridge_hk',
        account: 'H99999999',
        date: '2026-07-16',
        type: 'withdrawal',
        currency: 'HKD',
        amount: -500,
        description: 'Cash Withdrawal',
    };
    const key = (broker, account, type, amount) => `v2:${JSON.stringify([
        broker,
        account,
        '2026-07-16',
        type,
        'HKD',
        amount,
    ])}`;
    const hsbcDepositKey = key('hsbc', '000-999999-999', 'deposit', '500');
    const bochkWithdrawalKey = key('boc_hk', '65640001', 'withdrawal', '-500');

    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'boc_hk', 'longbridge_hk'],
        transactions: [hsbcDeposit, bochkWithdrawal, bochkDeposit, longbridgeWithdrawal],
        manualInternalTransferBindings: {[hsbcDepositKey]: bochkWithdrawalKey},
    });

    await page.goto('/trade/investment');

    const bochkRow = page.locator('#investment_history tr').filter({hasText: 'CBS TRANSFER'}).first();
    const bindingSelect = bochkRow.locator('select[data-investment-transfer-source-key]');
    await expect(bindingSelect).toHaveCount(1);
    const optionValues = await bindingSelect.locator('option').evaluateAll((options) => (
        options.map((option) => option.value)
    ));
    const longbridgeWithdrawalKey = key('longbridge_hk', 'H99999999', 'withdrawal', '-500');
    expect(optionValues).toContain(longbridgeWithdrawalKey);
    await expect(bindingSelect.locator('option').filter({hasText: 'Longbridge (HK)'})).toHaveCount(1);
    await expect(bindingSelect).toHaveValue('');
});

test('replays a bound cash transfer with outflow before deposit', async ({page}) => {
    const sourceKey = `v2:${JSON.stringify(['hsbc', '', '2024-11-27', 'deposit', 'USD', '3400'])}`;
    const targetKey = `v2:${JSON.stringify(['ibkr', '', '2024-11-27', 'withdrawal', 'USD', '-3400'])}`;
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'ibkr'],
        transactions: [
            {
                ledger_no: 8_000,
                broker: 'hsbc',
                date: '2024-11-27',
                type: 'deposit',
                currency: 'USD',
                amount: 3_400,
                description: 'Receiving deposit',
            },
            {
                ledger_no: 7_999,
                broker: 'ibkr',
                date: '2024-11-27',
                type: 'withdrawal',
                currency: 'USD',
                amount: -3_400,
                description: 'Transfer outflow',
            },
        ],
        manualInternalTransferBindings: {[sourceKey]: targetKey},
    });
    await page.goto('/trade/investment');

    const historyRows = page.locator('#investment_history tr[data-investment-history-row]');
    await expect(historyRows).toHaveCount(2);
    await expect.poll(() => historyRows.evaluateAll((rows) => (
        rows.map((row) => row.querySelectorAll('td')[3]?.textContent.trim())
    ))).toEqual(['Withdrawal', 'Deposit']);
});

test('keeps cross-date bound transfers out of the accounting reorder', async ({page}) => {
    const firstSourceKey = `v2:${JSON.stringify(['hsbc', '', '2026-06-22', 'deposit', 'USD', '50000'])}`;
    const secondSourceKey = `v2:${JSON.stringify(['hsbc', '', '2026-06-22', 'deposit', 'USD', '25000'])}`;
    const firstTargetKey = `v2:${JSON.stringify(['ibkr', '', '2026-06-18', 'withdrawal', 'USD_OR_MISSING', '-50000'])}`;
    const secondTargetKey = `v2:${JSON.stringify(['ibkr', '', '2026-06-19', 'withdrawal', 'USD_OR_MISSING', '-25000'])}`;
    await mockInvestmentReadApis(page, {
        brokers: ['ibkr', 'hsbc'],
        transactions: [
            {
                ledger_no: 18_001,
                broker: 'ibkr',
                date: '2026-06-18',
                type: 'withdrawal',
                currency: 'USD',
                amount: -50_000,
                description: 'CNH transfer leg 18 Jun',
            },
            {
                ledger_no: 18_002,
                broker: 'ibkr',
                date: '2026-06-19',
                type: 'withdrawal',
                currency: 'USD',
                amount: -25_000,
                description: 'CNH transfer leg 19 Jun',
            },
            {
                ledger_no: 18_003,
                broker: 'hsbc',
                date: '2026-06-22',
                type: 'deposit',
                currency: 'USD',
                amount: 50_000,
                description: 'CNH transfer receipt 1',
            },
            {
                ledger_no: 18_004,
                broker: 'hsbc',
                date: '2026-06-22',
                type: 'deposit',
                currency: 'USD',
                amount: 25_000,
                description: 'CNH transfer receipt 2',
            },
        ],
        manualInternalTransferBindings: {
            [firstSourceKey]: firstTargetKey,
            [secondSourceKey]: secondTargetKey,
        },
    });
    await page.goto('/trade/investment?range=max');
    await expect.poll(() => page.evaluate(() => (
        window.Chart?.getChart(document.querySelector('#investmentEquityChart'))?.data?.rawLabels?.length || 0
    ))).toBeGreaterThan(0);

    const chartValues = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        return (chart?.data?.rawLabels || []).map((date, index) => ({
            date,
            value: Number(chart.data.datasets?.[0]?.data?.[index]),
        }));
    });
    for (const date of ['2026-06-18', '2026-06-19', '2026-06-20', '2026-06-21', '2026-06-22']) {
        expect(chartValues.find((point) => point.date === date)?.value).toBeCloseTo(10_000, 8);
    }
    expect(chartValues.some((point) => Math.abs(point.value - 10_000) > 0.01)).toBe(false);
});

test('keeps the transfer principal bridge zero after a later posting and preserves the fee', async ({page}) => {
    const sourceKey = `v2:${JSON.stringify(['hsbc', '', '2026-06-22', 'deposit', 'USD', '990'])}`;
    const targetKey = `v2:${JSON.stringify(['ibkr', '', '2026-06-21', 'withdrawal', 'USD_OR_MISSING', '-1000'])}`;
    await mockInvestmentReadApis(page, {
        brokers: ['ibkr', 'hsbc'],
        transactions: [
            {
                ledger_no: 18_101,
                broker: 'ibkr',
                date: '2026-06-21',
                type: 'withdrawal',
                currency: 'USD',
                amount: -1_000,
                description: 'Transfer principal plus fee outflow',
            },
            {
                ledger_no: 18_102,
                broker: 'hsbc',
                date: '2026-06-22',
                type: 'deposit',
                currency: 'USD',
                amount: 990,
                description: 'Transfer principal receipt',
            },
        ],
        manualInternalTransferBindings: {[sourceKey]: targetKey},
    });
    await page.goto('/trade/investment?range=max');

    await expect.poll(() => page.evaluate(() => (
        window.Chart?.getChart(document.querySelector('#investmentEquityChart'))?.data?.rawLabels?.length || 0
    ))).toBeGreaterThan(0);

    const chartValues = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        return (chart?.data?.rawLabels || []).map((date, index) => ({
            date,
            value: Number(chart.data.datasets?.[0]?.data?.[index]),
        })).filter((point) => point.date >= '2026-06-21' && point.date <= '2026-06-22');
    });
    expect(chartValues.map((point) => point.value)).toEqual([9_990, 9_990]);
});

test('stored transfer bindings override stale ignore markers before equity replay', async ({page}) => {
    const sourceKey = `v2:${JSON.stringify(['hsbc', 'HSBC-TEST', '2026-06-18', 'deposit', 'USD', '1000'])}`;
    const targetKey = `v2:${JSON.stringify(['ibkr', 'IBKR-TEST', '2026-06-19', 'withdrawal', 'USD_OR_MISSING', '-1000'])}`;
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'ibkr'],
        transactions: [
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-06-18',
                type: 'deposit',
                currency: 'USD',
                amount: 1000,
                description: 'Stored binding source',
            },
            {
                broker: 'ibkr',
                account: 'IBKR-TEST',
                date: '2026-06-19',
                type: 'withdrawal',
                currency: 'USD',
                amount: -1000,
                description: 'Stored binding target',
            },
        ],
        manualInternalTransferBindings: {[sourceKey]: targetKey},
        manualInternalTransferIgnoredSourceKeys: [sourceKey],
    });
    await page.goto('/trade/investment?range=max');

    const sourceRow = page.locator('#investment_history tr').filter({hasText: 'Stored binding source'}).first();
    const bindingSelect = sourceRow.locator('select[data-investment-transfer-source-key]');
    await expect(bindingSelect).toHaveCount(1);
    await expect(bindingSelect).toHaveValue(targetKey);
    await expect(bindingSelect.locator('option:checked')).not.toHaveText('Incorrectly identified, ignore');

    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        return (chart?.data?.datasets?.[0]?.data || []).filter(Number.isFinite);
    })).toEqual(expect.arrayContaining([10_000]));
    const chartValues = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        return (chart?.data?.rawLabels || []).map((date, index) => ({
            date,
            value: Number(chart.data.datasets?.[0]?.data?.[index]),
        })).filter((point) => point.date >= '2026-06-18' && point.date <= '2026-06-19');
    });
    expect(chartValues.map((point) => point.value)).toEqual([10_000, 10_000]);
});

test('keeps same-day same-amount transfer rows independently selectable', async ({page}) => {
    const duplicateHsbcRows = [
        {
            ledger_no: 10_101,
            broker: 'hsbc',
            account: '000-999999-999',
            date: '2023-02-20',
            type: 'withdrawal',
            currency: 'HKD',
            amount: -100,
            description: 'TO USMART T453910QU272(09FEB02)',
            source: {file_kind: 'hsbc_statement_cash', source_filename: 'eStatementFile_723330.pdf', row_number: 31},
        },
        {
            ledger_no: 10_102,
            broker: 'hsbc',
            account: '000-999999-999',
            date: '2023-02-20',
            type: 'withdrawal',
            currency: 'HKD',
            amount: -100,
            description: 'DEMO ACCOUNT HOLDER REF00000000000000 18FEB',
            source: {file_kind: 'hsbc_statement_cash', source_filename: 'eStatementFile_723330.pdf', row_number: 33},
        },
    ];
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'usmart_hk'],
        transactions: [
            {
                ledger_no: 10_100,
                broker: 'usmart_hk',
                account: '94412536',
                date: '2023-02-20',
                type: 'deposit',
                currency: 'HKD',
                amount: 100,
                description: 'eDDA Cash Deposit',
                source: {file_kind: 'usmart_hk_statement_pdf', source_filename: '20230301-94412536.pdf', row_number: 29},
            },
            ...duplicateHsbcRows,
        ],
    });
    await page.goto('/trade/investment');

    const bindingSelect = page.locator(
        '#investment_history tr',
    ).filter({hasText: 'eDDA Cash Deposit'}).locator(
        'select[data-investment-transfer-source-key]',
    );
    await expect(bindingSelect).toHaveCount(1);
    const transferOptions = await bindingSelect.locator('option').evaluateAll((options) => options
        .filter((option) => option.value && option.value !== '__ignore__' && option.value !== '__restore__')
        .map((option) => ({value: option.value, label: option.textContent.trim()})));
    expect(transferOptions).toHaveLength(2);
    expect(new Set(transferOptions.map((option) => option.value)).size).toBe(2);
    expect(transferOptions.map((option) => option.label).join('\n')).toContain('TO USMART');
    expect(transferOptions.map((option) => option.label).join('\n')).toContain('DEMO ACCOUNT HOLDER');
});

test('offers one-day undated bank posting lag but excludes the second day', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'ibkr'],
        transactions: [
            {
                ledger_no: 20_100,
                broker: 'ibkr',
                account: 'U12345',
                date: '2025-09-03',
                type: 'deposit',
                currency: 'USD',
                amount: 18_500,
                description: 'Electronic Fund Transfer',
                source: {file_kind: 'ibkr_ofx', row_number: 282},
            },
            {
                ledger_no: 20_101,
                broker: 'hsbc',
                account: '000-888888-888',
                date: '2025-09-04',
                type: 'withdrawal',
                currency: 'USD',
                amount: -18_500,
                description: 'NEXT-DAY BANK TRANSFER',
                source: {file_kind: 'hsbc_statement_cash', row_number: 10},
            },
            {
                ledger_no: 20_102,
                broker: 'hsbc',
                account: '000-888888-888',
                date: '2025-09-05',
                type: 'withdrawal',
                currency: 'USD',
                amount: -18_500,
                description: 'SECOND-DAY UNRELATED WITHDRAWAL',
                source: {file_kind: 'hsbc_statement_cash', row_number: 11},
            },
        ],
    });
    await page.goto('/trade/investment');

    const bindingSelect = page.locator(
        '#investment_history tr',
    ).filter({hasText: 'Electronic Fund Transfer'}).locator(
        'select[data-investment-transfer-source-key]',
    );
    await expect(bindingSelect).toHaveCount(1);
    const transferOptions = await bindingSelect.locator('option').evaluateAll((options) => options
        .filter((option) => option.value && option.value !== '__ignore__' && option.value !== '__restore__')
        .map((option) => option.textContent.trim()));
    expect(transferOptions).toHaveLength(1);
    expect(transferOptions[0]).toContain('NEXT-DAY BANK TRANSFER');
    expect(transferOptions[0]).not.toContain('SECOND-DAY UNRELATED WITHDRAWAL');
});

test('does not offer future HSBC withdrawals after a Longbridge HK deposit', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'longbridge_hk'],
        transactions: [
            {
                ledger_no: 241,
                broker: 'longbridge_hk',
                account: 'H99999999',
                date: '2023-03-22',
                type: 'deposit',
                currency: 'HKD',
                amount: 50,
                description: 'Deposit Cash',
                source: {file_kind: 'longbridge_cash_flow', row_number: 6752},
            },
            {
                ledger_no: 242,
                broker: 'hsbc',
                account: '000-999999-999',
                date: '2023-03-22',
                type: 'withdrawal',
                currency: 'HKD',
                amount: -50,
                description: 'LONG BRIDGE HK LTD H99999999 22MAR',
                source: {file_kind: 'hsbc_statement_cash', row_number: 12},
            },
            {
                ledger_no: 243,
                broker: 'hsbc',
                account: '000-999999-999',
                date: '2023-03-23',
                type: 'withdrawal',
                currency: 'HKD',
                amount: -50,
                description: 'LONG BRIDGE HK LTD H99999999 22MAR',
                source: {file_kind: 'hsbc_statement_cash', row_number: 19},
            },
            {
                ledger_no: 244,
                broker: 'hsbc',
                account: '000-999999-999',
                date: '2023-03-25',
                type: 'withdrawal',
                currency: 'HKD',
                amount: -50,
                description: 'RETURN CHEQUE CHARGES',
                source: {file_kind: 'hsbc_statement_cash', row_number: 20},
            },
            {
                ledger_no: 245,
                broker: 'hsbc',
                account: '000-999999-999',
                date: '2023-03-27',
                type: 'withdrawal',
                currency: 'HKD',
                amount: -50,
                description: 'CR TO 000-999999-997 REF00000000000(26MAR23)',
                source: {file_kind: 'hsbc_statement_cash', row_number: 21},
            },
        ],
    });
    await page.goto('/trade/investment');

    const bindingSelect = page.locator(
        '#investment_history tr',
    ).filter({hasText: 'Deposit Cash'}).locator(
        'select[data-investment-transfer-source-key]',
    );
    await expect(bindingSelect).toHaveCount(1);
    const transferOptions = await bindingSelect.locator('option').evaluateAll((options) => options
        .filter((option) => option.value && option.value !== '__ignore__' && option.value !== '__restore__')
        .map((option) => option.textContent.trim()));
    expect(transferOptions).toHaveLength(2);
    expect(transferOptions.join('\n')).toContain('2023/03/22');
    expect(transferOptions.join('\n')).toContain('2023/03/23');
    expect(transferOptions.join('\n')).toContain('LONG BRIDGE HK LTD H99999999 22MAR');
    expect(transferOptions.join('\n')).not.toContain('RETURN CHEQUE CHARGES');
    expect(transferOptions.join('\n')).not.toContain('CR TO 000-999999-997');
});

test('keeps matched security transfer descriptions compact in history', async ({page}) => {
    const sourceKey = 'v2:["ibkr","ibkr:u-suffix:00001","2026-07-31","transfer_out","QQQI","5","USD"]';
    const targetKey = 'v2:["schwab","Individual ...001","2026-07-31","transfer_in","QQQI","5","USD"]';
    await mockInvestmentReadApis(page, {
        manualInternalTransferBindings: {[sourceKey]: targetKey},
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                account: 'U00000001',
                date: '2026-07-31',
                type: 'transfer_out',
                currency: 'USD',
                ticker: 'QQQI',
                quantity: 5,
                amount: 0,
                description: 'QQQI transfer out',
            },
            {
                ledger_no: 2,
                broker: 'schwab',
                account: 'Individual ...001',
                date: '2026-07-31',
                type: 'transfer_in',
                currency: 'USD',
                ticker: 'QQQI',
                quantity: 5,
                amount: 0,
                description: 'NEOS NASDAQ-100(R) HIGH INCOME ETF',
            },
        ],
    });
    await page.goto('/trade/investment');

    const transferLink = page.locator(
        '#investment_history .investment-transfer-link-shell:has(.investment-transfer-link-select)',
    );
    await expect(transferLink).toHaveCount(1);
    await expect(transferLink.locator('.investment-transfer-link-current')).toHaveText('QQQI × 5');
    await expect(transferLink.locator('.investment-transfer-link-current')).not.toContainText(
        'NEOS NASDAQ-100(R) HIGH INCOME ETF',
    );
    await expect(transferLink.locator('.investment-transfer-link-select option:checked'))
        .toHaveText('to Charles Schwab');
    const transferPresentation = await transferLink.evaluate((shell) => {
        const current = shell.querySelector('.investment-transfer-link-current');
        const select = shell.querySelector('.investment-transfer-link-select');
        const cell = shell.closest('td');
        if (!(current instanceof HTMLElement) || !(select instanceof HTMLSelectElement) || !(cell instanceof HTMLElement)) {
            return null;
        }
        const currentRect = current.getBoundingClientRect();
        const selectRect = select.getBoundingClientRect();
        const selectStyle = getComputedStyle(select);
        return {
            currentColor: getComputedStyle(current).color,
            cellColor: getComputedStyle(cell).color,
            currentLeft: currentRect.left,
            selectTextLeft: selectRect.left + Number.parseFloat(selectStyle.paddingInlineStart || '0'),
        };
    });
    expect(transferPresentation).not.toBeNull();
    expect(transferPresentation.currentColor).toBe(transferPresentation.cellColor);
    expect(Math.abs(transferPresentation.selectTextLeft - transferPresentation.currentLeft)).toBeLessThanOrEqual(1);
});

test('uses canonical tickers for dividend descriptions in transaction history', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                ledger_no: 6515,
                broker: 'ibkr',
                date: '2026-08-21',
                type: 'foreign_tax_withholding',
                ticker: 'QQQI',
                currency: 'USD',
                amount: -19.55,
                description: 'NEOS Nasdaq-100(R) High Income ETF (US78433H6751) Cash Dividend USD 0.6518 Per Share - US Tax',
            },
            {
                ledger_no: 6514,
                broker: 'ibkr',
                date: '2026-08-21',
                type: 'dividend',
                ticker: 'QQQI',
                currency: 'USD',
                amount: 195.54,
                description: 'NEOS Nasdaq-100(R) High Income ETF (US78433H6751) Cash Dividend USD 0.6518 Per Share (Ordinary Dividend)',
            },
        ],
    });
    await page.goto('/trade/investment');

    const taxDescriptionCell = page.locator('#investment_history tr')
        .filter({hasText: 'Foreign Tax Withholding'})
        .locator('td').nth(4);
    const dividendDescriptionCell = page.locator('#investment_history tr')
        .filter({hasText: 'Ordinary dividend'})
        .locator('td').nth(4);
    await expect(taxDescriptionCell).toHaveText('QQQI Cash dividend USD 0.6518 per share · US tax');
    await expect(taxDescriptionCell).not.toContainText('NEOS Nasdaq-100(R) High Income ETF');
    await expect(taxDescriptionCell).not.toContainText('US78433H6751');
    await expect(dividendDescriptionCell).toHaveText(
        'QQQI Cash dividend USD 0.6518 per share (Ordinary dividend)',
    );
});

test('replays a manually bound security transfer-out before its receipt', async ({page}) => {
    const sourceKey = 'v2:["ibkr","ibkr:u-suffix:00001","2026-07-31","transfer_out","QQQI","5","USD"]';
    const targetKey = 'v2:["schwab","Individual ...001","2026-07-31","transfer_in","QQQI","5","USD"]';
    await mockInvestmentReadApis(page, {
        brokers: ['ibkr', 'schwab'],
        manualInternalTransferBindings: {[sourceKey]: targetKey},
        transactions: [
            {
                broker: 'schwab',
                account: 'Individual ...001',
                date: '2026-07-31',
                type: 'transfer_in',
                currency: 'USD',
                ticker: 'QQQI',
                quantity: 5,
                amount: 0,
                description: 'NEOS NASDAQ-100(R) HIGH INCOME ETF',
                source: {row_number: 2},
            },
            {
                broker: 'ibkr',
                account: 'U00000001',
                date: '2026-07-31',
                type: 'transfer_out',
                currency: 'USD',
                ticker: 'QQQI',
                quantity: 5,
                amount: 0,
                description: 'FOP transfer out: QQQI',
                source: {row_number: 362},
            },
        ],
    });
    await page.goto('/trade/investment');

    const transferRowsLocator = page.locator(
        '#investment_history tr[data-investment-history-ticker="QQQI"]',
    );
    await expect(transferRowsLocator).toHaveCount(2);
    const transferRows = await transferRowsLocator.evaluateAll((rows) => rows.map((row) => ({
        ledgerNo: Number(row.dataset.investmentHistoryRow),
        text: row.textContent || '',
    })));
    const transferOut = transferRows.find((row) => row.text.includes('Transfer Out'));
    const transferIn = transferRows.find((row) => row.text.includes('Transfer In'));
    expect(transferOut).toBeDefined();
    expect(transferIn).toBeDefined();
    expect(transferOut.ledgerNo).toBeLessThan(transferIn.ledgerNo);
});

test('rewrites the counterpart order after manually binding a later-numbered source row', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['ibkr', 'schwab'],
        transactions: [
            {
                ledger_no: 6_154,
                broker: 'schwab',
                account: 'Individual ...001',
                date: '2026-07-31',
                type: 'transfer_in',
                currency: 'USD',
                ticker: 'QQQI',
                quantity: 5,
                amount: 0,
                description: 'NEOS NASDAQ-100(R) HIGH INCOME ETF',
                source: {row_number: 2},
            },
            {
                ledger_no: 6_161,
                broker: 'ibkr',
                account: 'U00000001',
                date: '2026-07-31',
                type: 'transfer_out',
                currency: 'USD',
                ticker: 'QQQI',
                quantity: 5,
                amount: 0,
                description: 'FOP transfer out: QQQI',
                source: {row_number: 362},
            },
        ],
    });
    let persistedBindingRequest = null;
    await page.route('**/api/investment/internal-transfer-binding', async (route) => {
        persistedBindingRequest = route.request().postDataJSON();
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                manual_internal_transfer_bindings: {
                    [persistedBindingRequest.source_key]: persistedBindingRequest.target_key,
                },
            }),
        });
    });
    await page.goto('/trade/investment');

    const bindingSelect = page.locator(
        '#investment_history tr[data-investment-history-ticker="QQQI"] select[data-investment-transfer-source-key]',
    );
    await expect(bindingSelect).toHaveCount(1);
    const bindingTarget = await bindingSelect.locator('option').evaluateAll((options) => (
        options.map((option) => option.value).find(Boolean)
    ));
    expect(bindingTarget).toBeTruthy();
    await bindingSelect.selectOption(bindingTarget);

    await expect.poll(() => persistedBindingRequest).toEqual({
        source_key: expect.stringMatching(/^v2:/),
        target_key: expect.stringMatching(/^v2:/),
    });
    const transferRows = page.locator('#investment_history tr[data-investment-history-ticker="QQQI"]');
    await expect.poll(() => transferRows.evaluateAll((rows) => {
        const renderedRows = rows.map((row) => ({
            ledgerNo: Number(row.dataset.investmentHistoryRow),
            text: row.textContent || '',
        }));
        return {
            transferOutLedgerNo: renderedRows.find((row) => row.text.includes('Transfer Out'))?.ledgerNo || 0,
            transferInLedgerNo: renderedRows.find((row) => row.text.includes('Transfer In'))?.ledgerNo || 0,
        };
    })).toEqual({transferOutLedgerNo: 1, transferInLedgerNo: 2});
    await expect(page.locator(
        '#investment_history tr[data-investment-history-ticker="QQQI"] select[data-investment-security-transfer-receipt-key]',
    )).toHaveCount(0);
    await expect(page.locator('#investment_history')).not.toContainText('Remove source confirmation');
    await expect(page.locator('#investment_history')).not.toContainText(
        'Confirmation changes only All brokers aggregation.',
    );
});

test('scopes an unbound Schwab receipt without blanking unaffected All brokers surfaces', async ({page}) => {
    const receiptKey = 'v2:["schwab","Individual ...001","2026-07-31","transfer_in","QQQI","5","USD"]';
    await mockInvestmentReadApis(page, {
        brokers: ['ibkr', 'schwab'],
        priceHistoryByTicker: {
            DRAM: {'2026-07-31': 11},
            QQQI: {'2026-07-31': 54},
        },
        summary: {
            security_transfer_reconciliation: {
                aggregate_holdings_available: false,
                aggregate_scope_status: 'blocked_source_attribution_required',
                pnl_unavailable_tickers: ['QQQI'],
                pnl_unavailable_reason: 'cross_broker_security_transfer_basis_unverified',
                aggregate_overlay: {
                    source_attribution_required_receipt_keys: [receiptKey],
                },
            },
        },
        transactions: [
            {
                broker: 'ibkr',
                account: 'U00000001',
                date: '2026-07-31',
                type: 'buy',
                currency: 'USD',
                ticker: 'DRAM',
                quantity: 10,
                price: 10,
                amount: -100,
                description: 'DRAM buy',
            },
            {
                broker: 'schwab',
                account: 'Individual ...001',
                date: '2026-07-31',
                type: 'transfer_in',
                currency: 'USD',
                ticker: 'QQQI',
                quantity: 5,
                amount: 0,
                description: 'QQQI transfer receipt',
            },
        ],
    });
    await page.goto('/trade/investment');

    const receiptConfirmation = page.locator(
        '#investment_history select[data-investment-security-transfer-receipt-key]',
    );
    await expect(receiptConfirmation).toHaveCount(1);
    await expect(receiptConfirmation).toHaveAttribute(
        'data-investment-security-transfer-receipt-key',
        receiptKey,
    );
    await expect(page.locator('#investment_history')).not.toContainText('Remove source confirmation');
    await expect(page.locator('#investment_history')).not.toContainText(
        'Confirmation changes only All brokers aggregation.',
    );

    await page.getByRole('radio', {name: 'Holdings'}).check({force: true});
    await expect(page.locator('#investment_holdings_panel .investment-holdings-empty')).toHaveCount(0);
    const dramRow = page.locator('#investment_holdings_panel [data-table-scroll] tr[data-investment-holdings-ticker="DRAM"]');
    const qqqiRow = page.locator('#investment_holdings_panel [data-table-scroll] tr[data-investment-holdings-ticker="QQQI"]');
    await expect(dramRow).toHaveCount(1);
    await expect(qqqiRow).toHaveCount(0);

    await page.getByRole('radio', {name: 'Metrics'}).check({force: true});
    await expect(page.locator('#investment_metrics_panel')).not.toContainText(
        'All brokers holdings, equity, and P&L are unavailable',
    );

    await page.getByRole('radio', {name: 'Stock details'}).check({force: true});
    await expect(page.locator('#stock_panel')).not.toContainText(
        'All brokers holdings, equity, and P&L are unavailable',
    );
    await expect(page.locator('#investment_equity_chart')).not.toContainText(
        'All brokers holdings, equity, and P&L are unavailable',
    );
});

test('persists the general appearance setting across reloads', async ({page}) => {
    await page.goto('/settings/general');
    await page.locator('[data-theme-mode-option][value="dark"]').check();
    await expect(page.locator('html')).toHaveAttribute('data-theme-override', 'dark');
    await page.reload();
    await expect(page.locator('[data-theme-mode-option][value="dark"]')).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-theme-override', 'dark');
});

test('uses the standard frosted slider and complete mapping on language settings', async ({page}) => {
    await page.goto('/settings/general');

    const tabs = page.locator('.settings-language-tabs');
    await expect(tabs).toHaveCount(1);
    await expect(tabs).toHaveAttribute('data-option-count', '2');
    const slider = await tabs.evaluate((element) => {
        const shell = getComputedStyle(element);
        const thumb = getComputedStyle(element, '::before');
        return {
            backdropFilter: shell.backdropFilter || shell.webkitBackdropFilter,
            thumbBackground: thumb.backgroundColor,
        };
    });
    expect(slider.backdropFilter).toContain('blur');
    expect(slider.thumbBackground).not.toBe('rgba(0, 0, 0, 0)');

    const mapping = await page.locator('[data-language-panel="current"] [data-language-paginated-body]').evaluate((body) => ({
        rowCount: body.querySelectorAll('[data-language-row]').length,
        keys: Array.from(body.querySelectorAll('input[name="translation_en"]')).map((input) => input.value),
        visibleRows: Array.from(body.querySelectorAll('[data-language-row]')).filter((row) => !row.hidden).length,
    }));
    expect(mapping.rowCount).toBeGreaterThanOrEqual(62);
    expect(mapping.visibleRows).toBe(10);
    expect(mapping.keys).toEqual(expect.arrayContaining([
        'Current',
        'History',
        'Language mapping pages',
        'Upload i18n mapping',
    ]));

    const historyTab = tabs.locator('[data-language-tab="history"]');
    await expect(historyTab).toHaveCount(1);
    await historyTab.click();
    await expect(historyTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-language-panel="history"]')).toBeVisible();
    expect(await tabs.evaluate((element) => element.dataset.segmentedActiveIndex)).toBe('1');
});

test('serializes Settings language tabs and pagination in the canonical URL', async ({page}) => {
    await page.goto('/settings/general?tab=current&page=2');
    await expect(page).toHaveURL(/\/settings\/general\?page=2$/);
    await expect(page.locator('[data-language-tab="current"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-language-panel="current"]')).toBeVisible();
    await expect(page.locator('[data-language-panel="current"] [data-language-row]:visible')).toHaveCount(10);

    await page.locator('[data-language-tab="history"]').click();
    await expect(page).toHaveURL(/\/settings\/general\?tab=history$/);
    await expect(page.locator('[data-language-tab="history"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-language-panel="history"]')).toBeVisible();

    await page.locator('[data-language-tab="current"]').click();
    await expect(page).toHaveURL(/\/settings\/general$/);
});

test('shows the standalone primary button specimen and keeps its inverted variant', async ({page}) => {
    await page.goto('/settings/style-tokens');

    const primaryCard = page.locator('[data-style-token-card="primary-button"]');
    const primary = primaryCard.locator('.style-token-demo > button');
    const invertedCard = page.locator('[data-style-token-card="primary-inverted-button"]');
    const inverted = invertedCard.locator('.style-token-demo > button');

    await expect(primaryCard).toHaveCount(1);
    await expect(primary).toHaveText('Maintain all data');
    await expect(primary).toHaveClass(/settings-inline-button-primary/);
    await expect(primary).not.toHaveClass(/settings-inline-button-primary-inverted/);
    await expect(invertedCard.locator('.style-token-title')).toHaveText('Primary (inverted) button');
    await expect(inverted).toHaveClass(/settings-inline-button-primary-inverted/);

    const state = await page.evaluate(() => {
        const button = document.querySelector('[data-style-token-card="primary-inverted-button"] .style-token-demo > button');
        if (!(button instanceof HTMLElement)) return null;
        const style = getComputedStyle(button);
        return {
            background: style.backgroundColor,
            color: style.color,
            borderWidth: style.borderTopWidth,
            radius: style.borderTopLeftRadius,
            minHeight: style.minHeight,
        };
    });

    expect(state).not.toBeNull();
    expect(state.borderWidth).toBe('1px');
    expect(state.radius).toBe('999px');
    expect(state.minHeight).toBe('32px');

    await page.setViewportSize({width: 390, height: 844});
    await page.reload();
    const narrowState = await page.evaluate(() => {
        const primaryButton = document.querySelector('[data-style-token-card="primary-button"] .style-token-demo > button');
        const invertedButton = document.querySelector('[data-style-token-card="primary-inverted-button"] .style-token-demo > button');
        const primaryRect = primaryButton?.getBoundingClientRect();
        const invertedRect = invertedButton?.getBoundingClientRect();
        return {
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            primaryWidth: primaryRect?.width ?? 0,
            invertedWidth: invertedRect?.width ?? 0,
        };
    });
    expect(narrowState.documentOverflow).toBeLessThanOrEqual(1);
    expect(narrowState.primaryWidth).toBeGreaterThan(0);
    expect(narrowState.invertedWidth).toBeGreaterThan(0);
});

test('shows the standard Switch specimen and preserves its checked geometry', async ({page}) => {
    const readSwitchGeometry = async (input) => input.evaluate((element) => {
        const shell = element.closest('.ios-switch-shell');
        const slider = shell?.querySelector('.ios-switch-slider');
        if (!(shell instanceof HTMLElement) || !(slider instanceof HTMLElement)) return null;
        const sliderStyle = getComputedStyle(slider);
        const thumbStyle = getComputedStyle(slider, '::after');
        return {
            shell: {width: shell.getBoundingClientRect().width, height: shell.getBoundingClientRect().height},
            slider: {
                width: slider.getBoundingClientRect().width,
                height: slider.getBoundingClientRect().height,
                borderRadius: sliderStyle.borderRadius,
                background: sliderStyle.backgroundColor,
                boxShadow: sliderStyle.boxShadow,
            },
            thumb: {
                width: thumbStyle.width,
                height: thumbStyle.height,
                borderRadius: thumbStyle.borderRadius,
                background: thumbStyle.backgroundColor,
                boxShadow: thumbStyle.boxShadow,
                transform: thumbStyle.transform,
            },
        };
    });

    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3d&strategy=supertrend_ai_gemini&interval=1m&stop_loss=0');
    const productionInput = page.locator('[data-dividend-reinvest-field] [data-switch-input], [data-dividend-reinvest-field] input[type="checkbox"]').first();
    await expect(page.locator('[data-dividend-reinvest-field]')).toBeVisible();
    await expect(productionInput).not.toBeChecked();
    const productionGeometry = await readSwitchGeometry(productionInput);

    await page.goto('/settings/style-tokens');

    const card = page.locator('[data-style-token-card="switch"]');
    const input = card.locator('[data-style-token-switch-input]');
    const slider = card.locator('.ios-switch-slider');

    await expect(card).toHaveCount(1);
    await expect(card.locator('.style-token-title')).toHaveText('Switch');
    await expect(input).not.toBeChecked();
    await expect(card.locator('.switch-label')).toHaveText('Reinvest cash dividends');
    await expect(slider).toHaveCSS('width', '40px');
    await expect(slider).toHaveCSS('height', '24px');
    expect(await readSwitchGeometry(input)).toEqual(productionGeometry);

    const before = await input.evaluate((element) => {
        const thumb = element.nextElementSibling;
        return thumb instanceof HTMLElement ? getComputedStyle(thumb, '::after').transform : null;
    });
    await input.check();
    await expect(input).toBeChecked();
    const after = await input.evaluate((element) => {
        const thumb = element.nextElementSibling;
        return thumb instanceof HTMLElement ? getComputedStyle(thumb, '::after').transform : null;
    });
    expect(before).not.toBe(after);

    await page.setViewportSize({width: 390, height: 844});
    await page.reload();
    await expect(page.locator('[data-style-token-card="switch"] [data-style-token-switch-input]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('keeps style-token showcase pills interactive and donut satellites centered', async ({page}) => {
    await page.goto('/settings/style-tokens');

    const rangeShell = page.locator('[data-style-token-card="segmented-control"] .range-mode-shell');
    await expect(rangeShell).toHaveAttribute('data-segmented-pill', 'measured');
    await expect(rangeShell).toHaveClass(/is-pill-ready/);
    expect(await rangeShell.locator('.range-mode-option span').evaluateAll((labels) => (
        labels.map((label) => getComputedStyle(label).whiteSpace)
    ))).toEqual(['nowrap', 'nowrap', 'nowrap']);
    const detailsOption = rangeShell.locator('label[for="style_token_range_details"]');
    await detailsOption.click();
    await expect(rangeShell.locator('#style_token_range_details')).toBeChecked();
    await expect(rangeShell).toHaveAttribute('data-active', 'details');
    await expect(rangeShell).toHaveAttribute('data-segmented-active-index', '1');
    await expect(rangeShell.locator('.range-mode-option span').nth(0)).toHaveCSS('font-weight', '400');
    await expect(rangeShell.locator('.range-mode-option span').nth(1)).toHaveCSS('font-weight', '700');
    await expect(rangeShell.locator('.range-mode-option span').nth(2)).toHaveCSS('font-weight', '400');
    await rangeShell.locator('label[for="style_token_range_metrics"]').click();
    await expect(rangeShell.locator('#style_token_range_metrics')).toBeChecked();
    await expect(rangeShell).toHaveAttribute('data-active', 'metrics');
    await expect(rangeShell).toHaveAttribute('data-segmented-active-index', '2');

    const pagination = page.locator('[data-style-token-card="pagination"] .local-store-pagination');
    await expect(page.locator('[data-style-token-card="pagination"] .style-token-title')).toHaveText('Pagination');
    await expect(pagination).toBeVisible();
    await expect(pagination).toHaveAttribute('aria-label', 'Pagination demo');
    await expect(pagination).toHaveClass(/local-store-pagination--floating/);
    await expect(pagination.locator('.local-store-page-nav')).toHaveCount(2);
    await expect(pagination.locator('.local-store-page-ellipsis')).toHaveCount(2);
    const pageButtons = pagination.locator('.local-store-page-button:not(.local-store-page-nav)');
    await expect(pageButtons).toHaveText(['1', '21', '22', '23', '24', '25', '64']);
    expect(await pageButtons.evaluateAll((buttons) => (
        buttons.map((button) => getComputedStyle(button).fontWeight)
    ))).toEqual(['400', '400', '400', '700', '400', '400', '400']);

    const orbit = page.locator('[data-style-token-card="portfolio-donut-orbit"] .style-token-portfolio-donut-orbit');
    await expect(orbit).toBeVisible();
    const orbitLogos = orbit.locator('.portfolio-donut-logo[data-style-token-donut-angle]');
    await expect(orbitLogos).toHaveCount(4);
    expect(await orbitLogos.evaluateAll((logos) => (
        logos.map((logo) => ({ticker: logo.dataset.ticker, source: logo.getAttribute('src')}))
    ))).toEqual([
        {ticker: 'AAPL', source: '/market-store/logos/AAPL.svg'},
        {ticker: 'GOOGL', source: '/market-store/logos/GOOGL.svg'},
        {ticker: 'NVDA', source: '/market-store/logos/NVDA.svg'},
        {ticker: 'MSFT', source: '/market-store/logos/MSFT.svg'},
    ]);
    await orbit.evaluate((element) => {
        element.style.width = '160px';
        element.style.height = '200px';
    });
    await expect.poll(() => orbit.evaluate((element) => {
        const logo = element.querySelector('.portfolio-donut-logo[data-style-token-donut-angle]');
        if (!(logo instanceof HTMLImageElement)) return null;
        const angle = Number.parseFloat(logo.dataset.styleTokenDonutAngle || '');
        const size = Number.parseFloat(getComputedStyle(element).getPropertyValue('--portfolio-donut-orbit-donut-size')) || 120;
        const logoSize = Number.parseFloat(getComputedStyle(element).getPropertyValue('--portfolio-donut-orbit-logo-size')) || 20;
        const orbitRadius = (size / 2) + ((logoSize * Math.SQRT2) / 2);
        const radians = ((angle - 90) * Math.PI) / 180;
        const expectedY = (element.clientHeight / 2) + (Math.sin(radians) * orbitRadius);
        const renderedY = Number.parseFloat(logo.style.top || 'NaN');
        return Math.abs(renderedY - expectedY);
    })).toBeLessThan(0.2);
});

test('keeps Investment Holdings allocation badge glyph slots stable', async ({page}) => {
    await page.goto('/settings/style-tokens');

    const geometry = await page.evaluate(() => Array.from(
        document.querySelectorAll('.style-token-holdings-allocation-badge-demo .investment-holdings-allocation-badge'),
    )
        .map((badge) => {
            const text = badge.textContent.replace(/\s+/g, '');
            if (!['1.11%', '8.88%'].includes(text)) return null;
            const rect = badge.getBoundingClientRect();
            const minor = badge.querySelector('.workspace-metric-value-minor')?.getBoundingClientRect();
            const glyphs = Array.from(badge.querySelectorAll('.investment-holdings-allocation-badge-glyph'))
                .map((glyph) => glyph.getBoundingClientRect().width);
            const majorGlyphs = Array.from(badge.querySelectorAll('.workspace-metric-value-major .investment-holdings-allocation-badge-glyph'))
                .map((glyph) => glyph.getBoundingClientRect().width);
            const minorGlyphs = Array.from(badge.querySelectorAll('.workspace-metric-value-minor .investment-holdings-allocation-badge-glyph'))
                .map((glyph) => glyph.getBoundingClientRect().width);
            const suffixGlyphs = Array.from(badge.querySelectorAll('.workspace-metric-value-suffix .investment-holdings-allocation-badge-glyph'))
                .map((glyph) => glyph.getBoundingClientRect().width);
            const majorGlyph = badge.querySelector('.workspace-metric-value-major .investment-holdings-allocation-badge-glyph');
            const minorGlyph = badge.querySelector('.workspace-metric-value-minor .investment-holdings-allocation-badge-glyph');
            const suffixGlyph = badge.querySelector('.workspace-metric-value-suffix .investment-holdings-allocation-badge-glyph');
            return {
                text,
                left: rect.left,
                right: rect.right,
                width: rect.width,
                decimalLeft: minor?.left ?? null,
                glyphs,
                majorGlyphs,
                minorGlyphs,
                suffixGlyphs,
                majorGlyphWidth: majorGlyph?.getBoundingClientRect().width ?? null,
                minorGlyphWidth: minorGlyph?.getBoundingClientRect().width ?? null,
                suffixGlyphWidth: suffixGlyph?.getBoundingClientRect().width ?? null,
                overflow: badge.scrollWidth > badge.clientWidth,
            };
        })
        .filter(Boolean));

    expect(geometry.map((item) => item.text)).toEqual(['1.11%', '8.88%']);
    expect(Math.abs(geometry[0].left - geometry[1].left)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(geometry[0].right - geometry[1].right)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(geometry[0].width - geometry[1].width)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(geometry[0].decimalLeft - geometry[1].decimalLeft)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(geometry[0].majorGlyphWidth - geometry[1].majorGlyphWidth)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(geometry[0].minorGlyphWidth - geometry[1].minorGlyphWidth)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(geometry[0].suffixGlyphWidth - geometry[1].suffixGlyphWidth)).toBeLessThanOrEqual(0.5);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement)
        .getPropertyValue('--investment-holdings-allocation-badge-glyph-width').trim())).toBe('0.625em');
    geometry.forEach((item) => {
        expect(item.glyphs.every((width) => width > 0)).toBe(true);
        expect(item.width).toBeLessThan(80);
        [item.majorGlyphs, item.minorGlyphs, item.suffixGlyphs].forEach((widths) => {
            expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(0.5);
        });
        expect(item.overflow).toBe(false);
    });
});

test('keeps the Style token segmented control at 36px without an outer border', async ({page}) => {
    await page.goto('/settings/style-tokens');

    const rangeShell = page.locator('[data-style-token-card="segmented-control"] .range-mode-shell');
    await expect(rangeShell).toHaveCSS('height', '36px');
    await expect(rangeShell).toHaveCSS('border-top-width', '0px');
    await expect(rangeShell).toHaveCSS('border-right-width', '0px');
    await expect(rangeShell).toHaveCSS('border-bottom-width', '0px');
    await expect(rangeShell).toHaveCSS('border-left-width', '0px');
});

test('allows the Style token Shared select filter to switch between All, Buy, and Sell', async ({page}) => {
    await page.goto('/settings/style-tokens');

    const card = page.locator('[data-style-token-card="shared-select-filter"]');
    const field = card.locator('[data-style-token-shared-select-demo] [data-shared-select-field]');
    const trigger = field.locator('[data-shared-select-trigger]');
    const dropdown = field.locator('[data-shared-select-dropdown]');
    const nativeSelect = field.locator('select.backtest-shared-select-native');

    await expect(trigger).toHaveText('All');
    await expect(dropdown).toBeVisible();
    await dropdown.locator('[role="option"][data-value="buy"]').click();
    await expect(trigger).toHaveText('Buy');
    await expect(nativeSelect).toHaveValue('buy');
    await expect(dropdown).toBeHidden();

    await trigger.click();
    await expect(dropdown).toBeVisible();
    await dropdown.locator('[role="option"][data-value="sell"]').click();
    await expect(trigger).toHaveText('Sell');
    await expect(nativeSelect).toHaveValue('sell');
});

test('shows the standard Period dropdown specimen in Style tokens', async ({page}) => {
    await page.goto('/settings/style-tokens');

    const card = page.locator('[data-style-token-card="shared-select-dropdown"]');
    const field = card.locator('[data-style-token-shared-select-dropdown-demo] [data-shared-select-field]');
    const trigger = field.locator('[data-shared-select-trigger]');
    const dropdown = field.locator('[data-shared-select-dropdown]');
    const nativeSelect = field.locator('select.backtest-shared-select-native');

    await expect(card).toHaveCount(1);
    await expect(card.locator('.style-token-title')).toHaveText('Shared select dropdown');
    await expect(trigger).toHaveText('1 year');
    await expect(trigger).toHaveAttribute('aria-label', 'Period: 1 year');
    await expect(dropdown).toBeHidden();
    await trigger.click();
    await expect(dropdown).toBeVisible();
    await expect(dropdown.locator('[role="option"]')).toHaveCount(10);
    await expect(dropdown.locator('[role="option"][data-value="1y"]')).toHaveAttribute('aria-selected', 'true');
    await expect(dropdown.locator('[role="option"][data-value="1y"]')).toHaveCSS('border-radius', '999px');

    const childClassNames = await dropdown.locator('[role="option"]').first().evaluate((option) => (
        [...option.children].map((child) => child.className)
    ));
    expect(childClassNames).toEqual(['trade-strategy-dropdown-check', 'trade-strategy-dropdown-text']);

    await dropdown.locator('[role="option"][data-value="2y"]').click();
    await expect(trigger).toHaveText('2 years');
    await expect(trigger).toHaveAttribute('aria-label', 'Period: 2 years');
    await expect(nativeSelect).toHaveValue('2y');
    await expect(dropdown).toBeHidden();

    await trigger.click();
    await expect(dropdown).toBeVisible();
    await page.setViewportSize({width: 390, height: 844});
    await page.reload();
    await expect(page.locator('[data-style-token-card="shared-select-dropdown"] [data-style-token-shared-select-dropdown-demo]')).toBeVisible();
    await page.locator('[data-style-token-card="shared-select-dropdown"] [data-shared-select-trigger]').click();
    await expect(page.locator('[data-style-token-card="shared-select-dropdown"] [data-shared-select-dropdown]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('uses pill corners for Shared select filter option highlights', async ({page}) => {
    await page.goto('/settings/style-tokens');

    const card = page.locator('[data-style-token-card="shared-select-filter"]');
    const selectedOption = card.locator('.trade-strategy-dropdown-option.is-selected');
    const hoverOption = card.locator('.trade-strategy-dropdown-option').nth(1);

    await expect(selectedOption).toHaveCount(1);
    await expect(hoverOption).toHaveCount(1);

    const selectedRadius = await selectedOption.evaluate((option) => getComputedStyle(option).borderRadius);
    expect(selectedRadius).toBe('999px');

    await hoverOption.hover();
    const hoverState = await hoverOption.evaluate((option) => ({
        borderRadius: getComputedStyle(option).borderRadius,
        background: getComputedStyle(option).backgroundColor,
    }));
    expect(hoverState.borderRadius).toBe('999px');
    expect(hoverState.background).not.toBe('rgba(0, 0, 0, 0)');
});

test('demonstrates the shared filter header contract in the standard table tokens', async ({page}) => {
    await page.goto('/settings/style-tokens');

    const card = page.locator('[data-style-token-card="scrollable-table"]');
    const header = card.locator('[data-style-token-table-filter-header]');
    const defaultLabel = header.locator('.scrollable-data-table-filter-default-label');
    const field = header.locator('[data-style-token-table-filter-field]');
    const trigger = header.locator('[data-style-token-table-filter-trigger]');
    const summary = card.locator('[data-style-token-table-filter-summary]');
    const pagination = card.locator('[data-style-token-table-pagination]');
    const scroll = card.locator('.style-token-table-demo-scroll');

    await expect(header).toHaveCount(1);
    await expect(trigger).toHaveText('All');
    await expect(pagination).toBeVisible();
    await expect(pagination).toHaveAttribute('data-pagination-page-count', '2');
    await expect(pagination).toHaveClass(/local-store-pagination--floating/);
    await expect(card.locator('[data-style-token-table-demo-row]:not([hidden])')).toHaveCount(6);
    const scrollState = await scroll.evaluate((element) => ({
        overflowY: getComputedStyle(element).overflowY,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
    }));
    expect(scrollState.overflowY).toBe('auto');
    expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
    await expect.poll(() => field.evaluate((element) => getComputedStyle(element).opacity)).toBe('0');

    await trigger.hover({force: true});
    await page.waitForTimeout(200);
    const hoverState = await header.evaluate((element) => {
        const label = element.querySelector('.scrollable-data-table-filter-default-label');
        const fieldElement = element.querySelector('.scrollable-data-table-filter-field');
        const activeLabel = element.querySelector('.trade-strategy-trigger-label');
        const triggerElement = element.querySelector('[data-style-token-table-filter-trigger]');
        if (!(label instanceof HTMLElement)
            || !(fieldElement instanceof HTMLElement)
            || !(activeLabel instanceof HTMLElement)
            || !(triggerElement instanceof HTMLElement)) return null;
        const triggerStyle = getComputedStyle(triggerElement);
        return {
            defaultOpacity: getComputedStyle(label).opacity,
            fieldOpacity: getComputedStyle(fieldElement).opacity,
            fontFamily: triggerStyle.fontFamily,
            fontSize: triggerStyle.fontSize,
            fontWeight: triggerStyle.fontWeight,
            lineHeight: triggerStyle.lineHeight,
            alignment: getComputedStyle(activeLabel).justifyContent,
        };
    });
    expect(hoverState).toEqual(expect.objectContaining({
        defaultOpacity: '0',
        fieldOpacity: '1',
        alignment: 'center',
    }));
    expect(hoverState?.fontFamily).not.toBe('Arial');

    await trigger.click();
    const dropdown = page.locator('[data-style-token-table-filter-dropdown]');
    await expect(dropdown).toBeVisible();
    await dropdown.locator('[data-style-token-table-filter-option="buy"]').click();
    await expect(trigger).toHaveText('Buy');
    await expect(summary).toHaveText('5 filtered of 12 total');
    await expect(card.locator('[data-style-token-table-demo-row]:not([hidden])')).toHaveCount(5);
    await expect(pagination).toBeHidden();

    await trigger.click();
    await page.locator('[data-style-token-table-filter-dropdown] [data-style-token-table-filter-option="all"]').click();
    await expect(summary).toHaveText('12 filtered of 12 total');
    await expect(card.locator('[data-style-token-table-demo-row]:not([hidden])')).toHaveCount(6);
    await pagination.locator('[data-pagination-target="2"]').click();
    await expect(pagination.locator('[data-pagination-target="2"]')).toHaveAttribute('aria-current', 'page');
    await expect(card.locator('[data-style-token-table-demo-row]:not([hidden])')).toHaveCount(6);
    await expect(defaultLabel).toHaveCount(1);
});

test('uses the canonical Frosted glass material for Shared select filter', async ({page}) => {
    await page.goto('/settings/style-tokens');

    const card = page.locator('[data-style-token-card="shared-select-filter"]');
    const dropdown = card.locator('.backtest-shared-select-dropdown');
    await expect(dropdown).toBeVisible();

    const material = await dropdown.evaluate((element) => {
        const style = getComputedStyle(element);
        const probe = document.createElement('div');
        probe.style.cssText = [
            'position: fixed',
            'inline-size: 1px',
            'block-size: 1px',
            'background: var(--frosted-glass-background)',
            'border: var(--frosted-glass-border)',
            'box-shadow: var(--frosted-glass-shadow)',
            'backdrop-filter: var(--frosted-glass-blur)',
            '-webkit-backdrop-filter: var(--frosted-glass-blur)',
        ].join(';');
        document.body.append(probe);
        const expected = getComputedStyle(probe);
        const material = {
            actual: {
                background: style.backgroundColor,
                backgroundImage: style.backgroundImage,
                border: style.border,
                boxShadow: style.boxShadow,
                backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
            },
            expected: {
                background: expected.backgroundColor,
                backgroundImage: expected.backgroundImage,
                border: expected.border,
                boxShadow: expected.boxShadow,
                backdropFilter: expected.backdropFilter || expected.webkitBackdropFilter,
            },
        };
        probe.remove();
        return material;
    });

    expect(material.actual).toEqual(material.expected);
});

test('renders the canonical frosted-glass material showcase', async ({page}) => {
    await page.goto('/settings/material-tokens');

    const materialCards = page.locator('[data-style-token-card]');
    await expect(materialCards).toHaveCount(1);
    const materialCard = page.locator('[data-style-token-card="frosted-glass"]');
    await expect(materialCard).toHaveCount(1);
    await expect(materialCard.locator('.style-token-title')).toHaveText('Frosted glass');

    const showcase = materialCard.locator('.style-token-demo-card');
    await expect(showcase).toBeVisible();
    const material = await showcase.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
            width: rect.width,
            height: rect.height,
            backgroundImage: style.backgroundImage,
            backgroundColor: style.backgroundColor,
            borderWidth: style.borderTopWidth,
            boxShadow: style.boxShadow,
            backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
        };
    });

    expect(material.width).toBeGreaterThan(200);
    expect(material.height).toBeGreaterThanOrEqual(168);
    expect(material.backgroundImage).not.toBe('none');
    expect(material.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(material.borderWidth).not.toBe('0px');
    expect(material.boxShadow).not.toBe('none');
    expect(material.backdropFilter).toContain('blur');
});

test('uses pill corners for sidebar navigation selection and hover states', async ({page}) => {
    await page.goto('/trade/investment');
    const liveTradingItem = page.locator('aside#app_sidebar .settings-nav-item[href="/trade/live-trading"]');
    await expect(liveTradingItem).toHaveCount(1);
    await liveTradingItem.hover();
    const sidebarState = await page.evaluate(() => {
        const navigation = document.querySelector('aside#app_sidebar .settings-nav');
        const activeItem = document.querySelector('aside#app_sidebar .settings-nav-item.is-active');
        const hoverItem = document.querySelector('aside#app_sidebar .settings-nav-item[href="/trade/live-trading"]');
        return {
            activeRadius: activeItem ? getComputedStyle(activeItem).borderRadius : '',
            activeSurfaceRadius: navigation ? getComputedStyle(navigation, '::before').borderRadius : '',
            hoverRadius: hoverItem ? getComputedStyle(hoverItem).borderRadius : '',
        };
    });
    expect(sidebarState).toEqual({
        activeRadius: '999px',
        activeSurfaceRadius: '999px',
        hoverRadius: '999px',
    });
});

test('honors reduced-motion preference in CSS and the shared motion library', async ({page}) => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.goto('/settings/general');
    const motionState = await page.evaluate(() => ({
        reduced: window.AntigravityMotion?.reducedMotionQuery.matches,
        duration: getComputedStyle(document.querySelector('.settings-nav-item')).transitionDuration,
    }));
    expect(motionState.reduced).toBe(true);
    expect(motionState.duration.split(',').every((value) => value.trim() === '0.001s')).toBe(true);
});

test('opens and closes the sidebar at a mobile viewport', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/settings/about');
    const toggle = page.locator('#sidebar_toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.app-shell')).toHaveClass(/is-sidebar-collapsed/);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.app-shell')).toHaveClass(/is-sidebar-open/);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('keeps the sidebar hide control clickable above the iPad overlay', async ({page}) => {
    await page.setViewportSize({width: 768, height: 1024});
    await page.goto('/settings/about');

    const toggle = page.locator('#sidebar_toggle');
    const backdrop = page.locator('#sidebar_backdrop');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(backdrop).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(backdrop).toBeVisible();
    await expect.poll(() => toggle.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + (rect.width / 2), rect.top + (rect.height / 2));
        return Boolean(hit?.closest('#sidebar_toggle'));
    })).toBe(true);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(backdrop).toBeHidden();
    await expect(backdrop).toHaveCSS('display', 'none');
});

test('hides the sidebar through the touch path on an iPad portrait viewport', async ({browser, baseURL}) => {
    const context = await browser.newContext({
        baseURL,
        viewport: {width: 768, height: 1024},
        hasTouch: true,
        isMobile: true,
    });
    const page = await context.newPage();

    try {
        await page.goto('/settings/about');
        const toggle = page.locator('#sidebar_toggle');
        const backdrop = page.locator('#sidebar_backdrop');

        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(await toggle.evaluate((element) => element.parentElement?.classList.contains('page'))).toBe(true);
        await tapAtCenter(page, toggle);
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(backdrop).toBeVisible();
        const toggleMotion = await toggle.evaluate((element) => ({
            pointerCoarse: window.matchMedia('(pointer: coarse)').matches,
            transitionProperty: getComputedStyle(element).transitionProperty,
        }));
        expect(toggleMotion.pointerCoarse).toBe(true);
        expect(toggleMotion.transitionProperty.split(',').map((value) => value.trim())).not.toContain('transform');
        await expect.poll(() => toggle.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + (rect.width / 2), rect.top + (rect.height / 2));
            return Boolean(hit?.closest('#sidebar_toggle'));
        })).toBe(true);

        await tapAtCenter(page, toggle);
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(backdrop).toBeHidden();
        await expect(backdrop).toHaveCSS('pointer-events', 'none');
    } finally {
        await context.close();
    }
});

test('keeps the backtest sidebar toggle touch-safe on a larger iPad viewport', async ({browser, baseURL}) => {
    const context = await browser.newContext({
        baseURL,
        viewport: {width: 1024, height: 1366},
        hasTouch: true,
        isMobile: true,
    });
    const page = await context.newPage();

    try {
        await page.goto('/workspaces/backtest?stop_loss=0');
        const toggle = page.locator('#sidebar_toggle');

        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        const toggleMotion = await toggle.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const hit = document.elementFromPoint(rect.left + (rect.width / 2), rect.top + (rect.height / 2));
            return {
                pointerCoarse: window.matchMedia('(pointer: coarse)').matches,
                width: rect.width,
                height: rect.height,
                transitionProperty: style.transitionProperty,
                hitToggle: Boolean(hit?.closest('#sidebar_toggle')),
            };
        });
        expect(toggleMotion.pointerCoarse).toBe(true);
        expect(toggleMotion.width).toBeGreaterThanOrEqual(44);
        expect(toggleMotion.height).toBeGreaterThanOrEqual(44);
        expect(toggleMotion.transitionProperty.split(',').map((value) => value.trim())).not.toContain('transform');
        expect(toggleMotion.hitToggle).toBe(true);

        await tapAtCenter(page, toggle);
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await tapAtCenter(page, toggle);
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    } finally {
        await context.close();
    }
});

test('resizes the backtest overview and transaction history with the shared section handle', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?stop_loss=0');

    const handle = page.locator('#backtest_section_resizer');
    const exactHandle = page.locator(
        'xpath=/html/body/main/div/section/section/div/article[2]/article/button',
    );
    const overview = page.locator('.backtest-trade-performance-card');
    const history = page.locator('#backtest_history_surface');
    await expect(handle).toBeVisible();
    await expect(exactHandle).toHaveCount(1);
    await expect(exactHandle).toHaveAttribute('id', 'backtest_section_resizer');

    const handleGeometry = await handle.evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        lineHeight: getComputedStyle(element, '::before').height,
    }));
    expect(handleGeometry.height).toBe(12);
    expect(handleGeometry.lineHeight).toBe('1px');

    const before = await page.evaluate(() => ({
        overview: document.querySelector('.backtest-trade-performance-card')?.getBoundingClientRect().height,
        history: document.querySelector('#backtest_history_surface')?.getBoundingClientRect().height,
    }));
    await handle.focus();
    await handle.press('ArrowUp');
    await expect.poll(() => page.evaluate((beforeSize) => {
        const overviewHeight = document.querySelector('.backtest-trade-performance-card')?.getBoundingClientRect().height || 0;
        const historyHeight = document.querySelector('#backtest_history_surface')?.getBoundingClientRect().height || 0;
        return overviewHeight < beforeSize.overview && historyHeight > beforeSize.history;
    }, before)).toBe(true);
    const after = await page.evaluate(() => ({
        overview: document.querySelector('.backtest-trade-performance-card')?.getBoundingClientRect().height,
        history: document.querySelector('#backtest_history_surface')?.getBoundingClientRect().height,
    }));
    expect(after.overview).toBeLessThan(before.overview);
    expect(after.history).toBeGreaterThan(before.history);
    await expect.poll(() => handle.getAttribute('aria-valuenow')).not.toBe(String(Math.round(before.overview)));
    await expect(overview).toHaveJSProperty('hidden', false);
    await expect(history).toBeVisible();

    const pointerBefore = await page.evaluate(() => ({
        overview: document.querySelector('.backtest-trade-performance-card')?.getBoundingClientRect().height,
        history: document.querySelector('#backtest_history_surface')?.getBoundingClientRect().height,
    }));
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error('Backtest section resizer did not have a clickable bounding box.');
    await page.mouse.move(handleBox.x + (handleBox.width / 2), handleBox.y + (handleBox.height / 2));
    await page.mouse.down();
    await page.mouse.move(
        handleBox.x + (handleBox.width / 2),
        handleBox.y - 48,
    );
    await page.mouse.up();
    await expect.poll(() => page.evaluate((beforeSize) => {
        const overviewHeight = document.querySelector('.backtest-trade-performance-card')?.getBoundingClientRect().height || 0;
        const historyHeight = document.querySelector('#backtest_history_surface')?.getBoundingClientRect().height || 0;
        return overviewHeight < beforeSize.overview && historyHeight > beforeSize.history;
    }, pointerBefore)).toBe(true);
});

test('rebinds the backtest section handle after same-page result hydration', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?stop_loss=0');

    const handle = page.locator('#backtest_section_resizer');
    expect(page.url()).toContain('stop_loss=0');
    await expect(handle).toBeVisible();
    await expect(page.locator('#stop_loss')).not.toBeChecked();
    await page.locator('label[for="stop_loss"]').click();
    await expect(page.locator('#stop_loss')).toBeChecked();
    await expect.poll(() => page.url()).not.toContain('stop_loss=0');
    await expect(handle).toHaveAttribute('aria-valuenow', /\d+/);

    const before = await page.evaluate(() => ({
        overview: document.querySelector('.backtest-trade-performance-card')?.getBoundingClientRect().height,
        history: document.querySelector('#backtest_history_surface')?.getBoundingClientRect().height,
    }));
    await handle.focus();
    await handle.press('ArrowDown');
    await expect.poll(() => page.evaluate((beforeSize) => {
        const overviewHeight = document.querySelector('.backtest-trade-performance-card')?.getBoundingClientRect().height || 0;
        const historyHeight = document.querySelector('#backtest_history_surface')?.getBoundingClientRect().height || 0;
        return overviewHeight > beforeSize.overview && historyHeight < beforeSize.history;
    }, before)).toBe(true);

    const pointerBefore = await page.evaluate(() => ({
        overview: document.querySelector('.backtest-trade-performance-card')?.getBoundingClientRect().height,
        history: document.querySelector('#backtest_history_surface')?.getBoundingClientRect().height,
    }));
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error('Hydrated Backtest section resizer did not have a clickable bounding box.');
    await page.mouse.move(handleBox.x + (handleBox.width / 2), handleBox.y + (handleBox.height / 2));
    await page.mouse.down();
    await page.mouse.move(
        handleBox.x + (handleBox.width / 2),
        handleBox.y - 48,
    );
    await page.mouse.up();
    await expect.poll(() => page.evaluate((beforeSize) => {
        const overviewHeight = document.querySelector('.backtest-trade-performance-card')?.getBoundingClientRect().height || 0;
        const historyHeight = document.querySelector('#backtest_history_surface')?.getBoundingClientRect().height || 0;
        return overviewHeight < beforeSize.overview && historyHeight > beforeSize.history;
    }, pointerBefore)).toBe(true);
});

test('keeps the Backtest Metrics and Transactions pill synchronized', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=supertrend_ai_gemini');

    const viewSegmented = page.locator('#backtest_history_view_segmented');
    const historyArticle = page.locator('#backtest_history_surface');
    await expect(page.locator('#backtest_view_segmented')).toHaveCount(0);
    await expect(page.locator('#backtest_view_surface')).toHaveAttribute('data-active-view', 'overview');
    await expect(page.locator('#backtest_overview_panel')).toBeVisible();
    await expect(page.locator('#backtest_history_transactions_panel')).toBeVisible();
    await expect(page.locator('#backtest_history_metrics_panel')).toBeHidden();
    await expect(historyArticle.locator('.investment-history-heading-row')).toHaveCount(0);

    await page.locator('label[for="backtest_history_metrics"]').click();
    await expect(page.locator('#backtest_history_surface')).toHaveAttribute('data-active-view', 'metrics');
    await expect(page.locator('#backtest_history_metrics_panel')).toBeVisible();
    await expect(page.locator('#backtest_metrics_panel .trade-metric-card')).toHaveCount(10);
    await expect(page.locator('#backtest_history_transactions_panel')).toBeHidden();
    await expect.poll(() => viewSegmented.evaluate((element) => ({
        active: element.dataset.active,
        activeIndex: element.style.getPropertyValue('--segmented-active-index'),
    }))).toEqual({active: 'metrics', activeIndex: '0'});
    const centeredPill = await page.evaluate(() => {
        const surface = document.querySelector('#backtest_history_surface')?.getBoundingClientRect();
        const pill = document.querySelector('#backtest_history_view_segmented')?.getBoundingClientRect();
        return {
            centerDelta: Math.abs((pill.left + (pill.width / 2)) - (surface.left + (surface.width / 2))),
            leftGap: pill.left - surface.left,
            rightGap: surface.right - pill.right,
        };
    });
    expect(centeredPill.centerDelta).toBeLessThanOrEqual(1);
    expect(centeredPill.leftGap).toBeGreaterThanOrEqual(0);
    expect(centeredPill.rightGap).toBeGreaterThanOrEqual(0);

    const transactionPageSize = await page.evaluate(() => (
        window.ANTIGRAVITY_LOCAL_STORE_PAGINATION?.LOCAL_STORE_PAGINATION_TRANSACTION_PAGE_SIZE
    ));
    expect(transactionPageSize).toBe(100);
    expect(await historyArticle.locator('tbody tr').count()).toBeLessThanOrEqual(100);
    await page.locator('label[for="backtest_history_transactions"]').click();
    await expect(page.locator('#backtest_history_surface')).toHaveAttribute('data-active-view', 'transactions');
    await expect(page.locator('#backtest_history_transactions_panel')).toBeVisible();
    await expect(page.locator('#backtest_history_metrics_panel')).toBeHidden();
    await expect(historyArticle.locator('#tradeTransactionsPagination')).toBeHidden();

    await expect.poll(() => viewSegmented.evaluate((element) => (
        element.style.getPropertyValue('--segmented-active-index')
    ))).toBe('1');

    await page.setViewportSize({width: 390, height: 844});
    await expect(viewSegmented).toBeVisible();
    const narrowPill = await page.evaluate(() => {
        const surface = document.querySelector('#backtest_history_surface')?.getBoundingClientRect();
        const pill = document.querySelector('#backtest_history_view_segmented')?.getBoundingClientRect();
        return {
            leftGap: pill.left - surface.left,
            rightGap: surface.right - pill.right,
            width: pill.width,
        };
    });
    expect(narrowPill.width).toBeGreaterThan(0);
    expect(narrowPill.leftGap).toBeGreaterThanOrEqual(0);
    expect(narrowPill.rightGap).toBeGreaterThanOrEqual(0);
});

test('keeps the Backtest interval pill aligned and static in the 1m state', async ({page}) => {
    await page.setViewportSize({width: 1033, height: 841});
    await page.goto('/workspaces/backtest?ticker=DRAM&range=1d&interval=1m');

    const intervalShell = page.locator('#backtest_interval_control');
    await expect(intervalShell).toHaveAttribute('data-segmented-pill', 'measured');
    await expect(intervalShell.locator('#backtest_interval_1m')).toBeChecked();

    const pillState = await intervalShell.evaluate((element) => {
        const pseudo = getComputedStyle(element, '::before');
        const shellRect = element.getBoundingClientRect();
        const activeOption = element.querySelector('input:checked')?.closest('.segmented-control-option');
        const activeRect = activeOption?.getBoundingClientRect();
        const transformMatch = pseudo.transform.match(
            /^matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*([-\d.]+)/,
        );
        const translateX = pseudo.transform === 'none'
            ? 0
            : Number.parseFloat(transformMatch?.[1] || 'NaN');
        const thumbLeft = shellRect.left + (Number.parseFloat(pseudo.left) || 0) + translateX;
        const thumbRight = thumbLeft + (Number.parseFloat(pseudo.width) || 0);
        return {
            transition: pseudo.transition,
            opacity: pseudo.opacity,
            leftDelta: activeRect ? Math.abs(thumbLeft - activeRect.left) : Number.POSITIVE_INFINITY,
            rightDelta: activeRect ? Math.abs(thumbRight - activeRect.right) : Number.POSITIVE_INFINITY,
            shellRight: shellRect.right,
            thumbRight,
        };
    });

    expect(pillState.transition).toBe('none');
    expect(pillState.opacity).toBe('1');
    expect(pillState.leftDelta).toBeLessThanOrEqual(1);
    expect(pillState.rightDelta).toBeLessThanOrEqual(1);
    expect(pillState.thumbRight).toBeLessThanOrEqual(pillState.shellRight + 1);
});

test('applies the Scrollable table style to Backtest transaction details', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    const readHostStyle = (locator) => locator.evaluate((element) => {
        const style = getComputedStyle(element);
        return Object.fromEntries([
            'display', 'position', 'flex', 'minHeight', 'margin', 'padding', 'overflow',
            'boxSizing', 'backgroundColor', 'border', 'borderRadius', 'boxShadow',
        ].map((property) => [property, style[property]]));
    });

    await page.goto('/settings/style-tokens');
    const referenceTableShell = page.locator(
        '[data-style-token-card="scrollable-table"] .scrollable-data-table-shell.style-token-table-demo',
    );
    await expect(referenceTableShell).toBeVisible();
    const referenceStyle = await readHostStyle(referenceTableShell);

    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=supertrend_ai_gemini');
    const backtestTableHost = page.locator(
        'xpath=/html/body/main/div/section/section/div/article[2]/article/article[3]/div[2]',
    );
    await expect(backtestTableHost).toBeVisible();
    await expect(backtestTableHost).toHaveClass(/scrollable-data-table-shell/);
    await expect(backtestTableHost.locator(':scope > [data-table-header]')).toHaveCount(1);
    const backtestTableScroll = backtestTableHost.locator(':scope > [data-table-scroll]');
    await expect(backtestTableScroll).toHaveCount(1);
    await expect.poll(() => backtestTableScroll.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            overflowY: style.overflowY,
            hasInternalOverflow: element.scrollHeight > element.clientHeight,
        };
    })).toEqual({overflowY: 'auto', hasInternalOverflow: true});
    await expect.poll(() => readHostStyle(backtestTableHost)).toEqual(referenceStyle);
});

test('uses the global compact date format and split numeric typography in Backtest transactions', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});

    const setCompactDateFormat = async (value) => {
        await page.goto('/settings/general');
        const field = page.locator('[data-shared-select-kind="settings-short-date"]');
        await expect(field).toBeVisible();
        await field.locator('[data-shared-select-trigger]').click();
        const option = page.locator(`#settings_short_date_format_dropdown [data-value="${value}"]`);
        await expect(option).toBeVisible();
        await option.click();
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('#settings_short_date_format')).toHaveValue(value);
    };

    await setCompactDateFormat('dd_mm_yyyy');
    try {
        await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=supertrend_ai_gemini');
        const transactionHost = page.locator(
            'xpath=/html/body/main/div/section/section/div/article[2]/article/article[3]/div[2]',
        );
        await expect(transactionHost).toBeVisible();
        const firstRow = transactionHost.locator('table[data-table-body] tbody tr').first();
        await expect(firstRow).toBeVisible();

        const renderedState = await page.evaluate(() => {
            const state = JSON.parse(document.getElementById('antigravity_state')?.textContent || '{}');
            const row = document.querySelector('#backtest_history_table_wrap table[data-table-body] tbody tr');
            const numericCells = ['price', 'pnl', 'cash', 'equity'].map((className) => {
                const cell = row?.querySelector(`.${className}`);
                return {
                    hasMajor: Boolean(cell?.querySelector('.workspace-metric-value-major')),
                    hasMinor: Boolean(cell?.querySelector('.workspace-metric-value-minor')),
                    majorFontSize: cell?.querySelector('.workspace-metric-value-major')
                        ? getComputedStyle(cell.querySelector('.workspace-metric-value-major')).fontSize
                        : null,
                    minorFontSize: cell?.querySelector('.workspace-metric-value-minor')
                        ? getComputedStyle(cell.querySelector('.workspace-metric-value-minor')).fontSize
                        : null,
                };
            });
            return {
                shortDateFormat: state.dateDisplay?.short,
                dateText: row?.querySelector('.trade-transactions-date')?.textContent?.trim() || '',
                numericCells,
            };
        });

        expect(renderedState.shortDateFormat).toBe('dd_mm_yyyy');
        expect(renderedState.dateText).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
        expect(renderedState.numericCells).toHaveLength(4);
        renderedState.numericCells.forEach((cell) => {
            expect(cell.hasMajor).toBe(true);
            expect(cell.hasMinor).toBe(true);
            expect(Number.parseFloat(cell.minorFontSize)).toBeLessThan(Number.parseFloat(cell.majorFontSize));
        });
    } finally {
        await setCompactDateFormat('yyyy_mm_dd');
    }
});

test('starts every backtest strategy with its starter parameters from the dropdown', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?period=6mo&strategy=buy-and-hold');

    const strategyIds = await page.locator('#trade_strategy option').evaluateAll((options) => (
        options.map((option) => option.value)
    ));
    expect(strategyIds.length).toBeGreaterThan(1);

    for (const strategyId of strategyIds) {
        await page.locator('[data-trade-strategy-trigger]').click();
        const option = page.locator(
            `[data-trade-strategy-dropdown] [data-value="${strategyId}"]`
        );
        await expect(option).toBeVisible();
        await option.dispatchEvent('click');

        await expect.poll(() => page.locator('#trade_strategy').inputValue()).toBe(strategyId);
        await expect(page.locator('#backtest_view_surface')).toBeVisible();
        await expect(page.locator('#backtest_history_table_wrap')).toBeVisible();
        await expect.poll(() => page.evaluate(() => {
            const fields = Array.from(document.querySelectorAll('[data-strategy-param-key]'));
            const valuesMatchDefaults = fields.every((field) => {
                const control = field.querySelector('[data-strategy-param-input]');
                if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) return false;
                const value = String(control.value || '').trim();
                const defaultValue = String(control.dataset.default || '').trim();
                if (value === defaultValue) return true;
                const numericValue = Number(value);
                const numericDefault = Number(defaultValue);
                return value !== ''
                    && defaultValue !== ''
                    && Number.isFinite(numericValue)
                    && Number.isFinite(numericDefault)
                    && numericValue === numericDefault;
            });
            return {
                valuesMatchDefaults,
                hasPriceChart: Boolean(document.querySelector('#tradePriceChart')),
                hasEquityChart: Boolean(document.querySelector('#tradeEquityChart')),
            };
        })).toEqual({
            valuesMatchDefaults: true,
            hasPriceChart: true,
            hasEquityChart: true,
        });
    }
});

test('removes the horizontal reference line from the exact backtest equity canvas', async ({page}) => {
    await page.goto('/workspaces/backtest?ticker=QQQ&range=6mo&strategy=buy-and-hold');

    const exactCanvas = page.locator(
        'xpath=/html/body/main/div/section/section/div/article[2]/article/article[2]/div/div[2]/div[1]/article/div[2]/div[2]/div/canvas',
    );
    await expect(exactCanvas).toHaveCount(1);
    await expect(exactCanvas).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean(
        window.Chart?.getChart?.(document.querySelector('#tradeEquityChart')),
    ))).toBe(true);

    const chartState = await page.evaluate(() => {
        const chart = window.Chart.getChart(document.querySelector('#tradeEquityChart'));
        return {
            pluginIds: chart.config._config.plugins.map((plugin) => plugin.id || 'anonymous'),
            xGridVisible: chart.options.scales.x.grid.display,
            xBorderVisible: chart.options.scales.x.border.display,
        };
    });

    expect(chartState.pluginIds).not.toContain('tradeReferenceLine');
    expect(chartState.xGridVisible).toBe(false);
    expect(chartState.xBorderVisible).toBe(false);
});

test('formats Backtest price and equity axes with distinct precision', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});

    const readAxes = () => page.evaluate(() => {
        const readAxis = (selector) => {
            const chart = window.Chart?.getChart?.(document.querySelector(selector));
            if (!chart) return null;
            return {
                labels: chart.scales?.y?.ticks?.map((tick) => String(tick.label ?? '')).filter(Boolean) || [],
                width: chart.scales?.y?.width || 0,
            };
        };
        return {
            price: readAxis('#tradePriceChart'),
            equity: readAxis('#tradeEquityChart'),
        };
    });

    const assertAxisContract = async () => {
        await expect.poll(async () => {
            const axes = await readAxes();
            return Boolean(axes.price?.labels.length && axes.equity?.labels.length);
        }).toBe(true);

        const axes = await readAxes();
        const priceTickPattern = /^-?\d{1,3}(,\d{3})*\.\d{2}$/;
        const equityTickPattern = /^-?\d{1,3}(,\d{3})*$/;
        expect(axes.price?.labels.every((label) => priceTickPattern.test(label))).toBe(true);
        expect(axes.equity?.labels.every((label) => equityTickPattern.test(label))).toBe(true);
        expect(axes.price?.width).toBeGreaterThanOrEqual(72);
        expect(axes.equity?.width).toBeGreaterThanOrEqual(72);
    };

    await page.goto('/workspaces/backtest?ticker=TQQQ&range=5y&strategy=dca&stop_loss=0&month_day=1');
    await assertAxisContract();
    await page.goto('/workspaces/backtest?ticker=TQQQ&range=5y&strategy=buy-and-hold&stop_loss=0');
    await assertAxisContract();
});

test('enters DCA through the Backtest strategy dropdown and tunes private parameters', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=buy-and-hold');

    const strategyTrigger = page.locator(
        'xpath=/html/body/main/div/section/section/div/article[1]/form/div[10]/div[1]/div[1]/button',
    );
    await expect(strategyTrigger).toBeVisible();
    await expect(strategyTrigger).toBeEnabled();
    const triggerStyle = await strategyTrigger.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            backgroundColor: style.backgroundColor,
            borderColor: style.borderColor,
            pointerEvents: style.pointerEvents,
        };
    });
    expect(triggerStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(triggerStyle.borderColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(triggerStyle.pointerEvents).toBe('auto');

    await strategyTrigger.click();
    const strategyDropdown = page.locator('[data-trade-strategy-dropdown]');
    await expect(strategyDropdown).toBeVisible();
    const dropdownStyle = await strategyDropdown.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            position: style.position,
            backgroundColor: style.backgroundColor,
            pointerEvents: style.pointerEvents,
            zIndex: style.zIndex,
        };
    });
    expect(dropdownStyle.position).toBe('fixed');
    expect(dropdownStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(dropdownStyle.pointerEvents).toBe('auto');
    expect(Number(dropdownStyle.zIndex)).toBeGreaterThanOrEqual(10002);

    const dcaOption = strategyDropdown.locator('[data-value="dca"]');
    const dcaOptionBox = await dcaOption.boundingBox();
    if (!dcaOptionBox) throw new Error('DCA strategy option did not have a clickable bounding box.');
    await page.mouse.click(
        dcaOptionBox.x + (dcaOptionBox.width / 2),
        dcaOptionBox.y + (dcaOptionBox.height / 2),
    );
    await expect.poll(() => page.locator('#trade_strategy').inputValue()).toBe('dca');
    await expect.poll(() => new URL(page.url()).searchParams.get('strategy')).toBe('dca');
    await expect.poll(() => new URL(page.url()).searchParams.get('ticker')).toBe('TQQQ');
    const tuneButton = page.locator('[data-trade-strategy-tune-button]');
    const paramsPanel = page.locator('#trade_strategy_params_panel');
    await expect(tuneButton).toBeVisible();
    await expect(tuneButton).toBeEnabled();
    await expect(tuneButton).toHaveAttribute('aria-hidden', 'false');
    await expect(paramsPanel).toBeHidden();
    await tuneButton.click();
    await expect(tuneButton).toHaveAttribute('aria-expanded', 'true');
    await expect(paramsPanel).toBeVisible();
    await expect(page.locator('[data-strategy-param-key="amount"]')).toBeVisible();
    await expect(page.locator('[data-strategy-param-key="frequency"]')).toBeVisible();
    await expect(page.locator('#tradePriceChart')).toBeVisible();
    await expect(page.locator('#tradeEquityChart')).toBeVisible();

    const dcaHistoryShell = page.locator('#backtest_history_table_wrap');
    await expect(dcaHistoryShell).toHaveClass(/scrollable-data-table-shell/);
    await expect(dcaHistoryShell.locator(':scope > [data-table-header]')).toHaveCount(1);
    await expect(dcaHistoryShell.locator(':scope > [data-table-scroll]')).toHaveCount(1);
    const dcaHistoryGeometry = await dcaHistoryShell.evaluate((shell) => {
        const header = shell.querySelector(':scope > [data-table-header]');
        const scroll = shell.querySelector(':scope > [data-table-scroll]');
        const headerRow = header?.querySelector('tr');
        const headerCell = header?.querySelector('th');
        if (!(header instanceof HTMLElement)
            || !(scroll instanceof HTMLElement)
            || !(headerRow instanceof HTMLElement)
            || !(headerCell instanceof HTMLElement)) return null;
        const headerRect = header.getBoundingClientRect();
        const headerRowRect = headerRow.getBoundingClientRect();
        const headerCellRect = headerCell.getBoundingClientRect();
        return {
            headerWidth: headerRect.width,
            headerHeight: headerRect.height,
            headerRowHeight: headerRowRect.height,
            headerCellHeight: headerCellRect.height,
            scrollOverflowY: getComputedStyle(scroll).overflowY,
            hasInternalVerticalOverflow: scroll.scrollHeight > scroll.clientHeight,
        };
    });
    expect(dcaHistoryGeometry).not.toBeNull();
    expect(dcaHistoryGeometry.headerWidth).toBeGreaterThanOrEqual(720);
    expect(dcaHistoryGeometry.headerHeight).toBeLessThan(60);
    expect(dcaHistoryGeometry.headerRowHeight).toBeLessThan(60);
    expect(dcaHistoryGeometry.headerCellHeight).toBeLessThan(60);
    expect(dcaHistoryGeometry.scrollOverflowY).toBe('auto');
    expect(dcaHistoryGeometry.hasInternalVerticalOverflow).toBe(true);
    const historyArticle = page.locator(
        'xpath=/html/body/main/div/section/section/div/article[2]/article/article[3]',
    );
    await expect(historyArticle.locator('.dca-transactions-shell')).toBeVisible();
    const transactionPageSize = await page.evaluate(() => (
        window.ANTIGRAVITY_LOCAL_STORE_PAGINATION?.LOCAL_STORE_PAGINATION_TRANSACTION_PAGE_SIZE
    ));
    expect(transactionPageSize).toBe(100);
    expect(await historyArticle.locator('tbody tr').count()).toBeLessThanOrEqual(100);
});

test('preserves the current ticker when switching strategies from the default ticker', async ({page}) => {
    await page.setViewportSize({width: 1033, height: 841});
    await page.goto('/workspaces/backtest?ticker=QQQ&range=3y&strategy=dca&stop_loss=0');

    const strategyTrigger = page.locator(
        'div.field.trade-strategy-field:nth-of-type(7) > div.trade-strategy-row:nth-of-type(1) > div.trade-strategy-combobox:nth-of-type(1) > button.trade-strategy-select.form-select',
    );
    await expect(strategyTrigger).toBeVisible();
    await strategyTrigger.click();

    const buyAndHoldOption = page.locator('[data-trade-strategy-dropdown] [data-value="buy-and-hold"]');
    await expect(buyAndHoldOption).toBeVisible();
    await buyAndHoldOption.click();

    await expect.poll(() => page.locator('#trade_strategy').inputValue()).toBe('buy-and-hold');
    await expect(page.locator('#ticker_1')).toHaveValue('QQQ');
});

test('uses lighter Backtest sidebar weights for range labels and strategy selection', async ({page}) => {
    await page.setViewportSize({width: 1033, height: 841});
    await page.goto('/workspaces/backtest?ticker=QQQI&strategy=dca&stop_loss=0');

    const weights = await page.evaluate(() => ({
        mode: getComputedStyle(document.querySelector('.range-mode-field > label')).fontWeight,
        period: getComputedStyle(document.querySelector('#period_panel > label')).fontWeight,
        strategy: getComputedStyle(document.querySelector('.trade-strategy-field .trade-strategy-select')).fontWeight,
    }));
    expect(weights).toEqual({mode: '500', period: '500', strategy: '300'});
});

test('keeps DCA strategy parameter menus above clipping and the panel compact', async ({page}) => {
    await page.setViewportSize({width: 1033, height: 841});
    await page.goto('/workspaces/backtest?ticker=QQQI&strategy=dca&stop_loss=0');

    await page.locator('[data-trade-strategy-tune-button]').click();
    await expect(page.locator('#trade_strategy_params_panel')).toBeVisible();

    const frequencyTrigger = page.locator(
        '[data-strategy-param-key="frequency"] [data-shared-select-trigger]',
    );
    await frequencyTrigger.click();
    const dropdown = page.locator('#strategy_param_frequency_dropdown');
    await expect(dropdown).toBeVisible();

    const layout = await page.evaluate(() => {
        const panel = document.querySelector('#trade_strategy_params_panel');
        const dropdown = document.querySelector('#strategy_param_frequency_dropdown');
        if (!(panel instanceof HTMLElement) || !(dropdown instanceof HTMLElement)) return null;
        const dropdownStyle = getComputedStyle(dropdown);
        return {
            isPageLevelOverlayChild: dropdown.parentElement?.matches('[data-shared-select-overlay]') || false,
            position: dropdownStyle.position,
            backgroundColor: dropdownStyle.backgroundColor,
            backgroundImage: dropdownStyle.backgroundImage,
            panelHeight: panel.getBoundingClientRect().height,
            menuBottom: dropdown.getBoundingClientRect().bottom,
            viewportHeight: window.innerHeight,
        };
    });

    expect(layout).not.toBeNull();
    expect(layout?.isPageLevelOverlayChild).toBe(true);
    expect(layout?.position).toBe('fixed');
    expect(layout?.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(layout?.backgroundImage).not.toBe('none');
    expect(layout?.menuBottom).toBeLessThanOrEqual((layout?.viewportHeight || 0) + 1);
    expect(layout?.panelHeight).toBeLessThan(320);
});

test('keeps the bottom Backtest strategy parameter dropdown fully visible', async ({page}) => {
    await page.setViewportSize({width: 990, height: 1242});
    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3d&strategy=supertrend_ai_gemini&interval=1m');

    await page.locator('[data-trade-strategy-tune-button]').click();
    await expect(page.locator('#trade_strategy_params_panel')).toBeVisible();
    const field = page.locator('[data-strategy-param-key="from_cluster"]');
    await expect(field).toBeVisible();
    await field.locator('[data-shared-select-trigger]').click();
    const dropdown = page.locator('#strategy_param_from_cluster_dropdown');
    await expect(dropdown).toBeVisible();

    const layout = await page.evaluate(() => {
        const trigger = document.querySelector('[data-strategy-param-key="from_cluster"] [data-shared-select-trigger]');
        const dropdown = document.querySelector('#strategy_param_from_cluster_dropdown');
        if (!(trigger instanceof HTMLElement) || !(dropdown instanceof HTMLElement)) return null;
        const triggerRect = trigger.getBoundingClientRect();
        const dropdownRect = dropdown.getBoundingClientRect();
        const options = Array.from(dropdown.querySelectorAll('[role="option"]')).map((option) => {
            const rect = option.getBoundingClientRect();
            return {
                text: option.textContent?.trim() || '',
                top: rect.top,
                bottom: rect.bottom,
            };
        });
        return {
            isPageLevelOverlayChild: dropdown.parentElement?.matches('[data-shared-select-overlay]') || false,
            position: getComputedStyle(dropdown).position,
            triggerTop: triggerRect.top,
            triggerBottom: triggerRect.bottom,
            dropdownTop: dropdownRect.top,
            dropdownBottom: dropdownRect.bottom,
            dropdownLeft: dropdownRect.left,
            dropdownRight: dropdownRect.right,
            triggerWidth: triggerRect.width,
            dropdownWidth: dropdownRect.width,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            options,
        };
    });
    expect(layout).not.toBeNull();
    expect(layout?.isPageLevelOverlayChild).toBe(true);
    expect(layout?.position).toBe('fixed');
    expect(layout?.dropdownTop).toBeGreaterThanOrEqual(0);
    expect(layout?.dropdownBottom).toBeLessThanOrEqual((layout?.viewportHeight || 0) + 1);
    expect(layout?.dropdownLeft).toBeGreaterThanOrEqual(0);
    expect(layout?.dropdownRight).toBeLessThanOrEqual((layout?.viewportWidth || 0) + 1);
    expect(layout?.dropdownWidth).toBeGreaterThanOrEqual((layout?.triggerWidth || 0) - 1);
    expect(layout?.options.every((option) => option.top >= 0 && option.bottom <= (layout?.viewportHeight || 0) + 1)).toBe(true);
    expect(layout?.options.map((option) => option.text)).toEqual(['Best', 'Average', 'Worst']);
});

test('reuses compact numeric display and Backtest section spacing contracts', async ({page}) => {
    await page.setViewportSize({width: 1033, height: 841});
    await page.goto('/workspaces/backtest?ticker=QQQI&range=3y&return=price&strategy=dca&stop_loss=0&month_day=1');

    const firstRow = page.locator('#backtest_history_table_wrap table[data-table-body] tbody tr').first();
    await expect(firstRow).toBeVisible();
    await expect(page.locator('#backtest_history_table_wrap table[data-table-header] thead th')).toHaveText([
        'No.',
        'Date time',
        'Side',
        'Price',
        'Quantity',
        'Realized P&L',
        'Unrealized P&L',
        'Cash',
        'Market value',
        'Equity',
    ]);
    await expect(firstRow.locator('td')).toHaveCount(10);

    const layout = await page.evaluate(() => {
        const overview = document.querySelector('#backtest_overview_panel > .backtest-surface');
        const contentCard = document.querySelector('.backtest-trade-performance-card');
        const resizer = document.querySelector('#backtest_section_resizer');
        const firstRow = document.querySelector('#backtest_history_table_wrap table[data-table-body] tbody tr');
        if (!(overview instanceof HTMLElement)
            || !(contentCard instanceof HTMLElement)
            || !(resizer instanceof HTMLElement)
            || !(firstRow instanceof HTMLTableRowElement)) {
            return null;
        }
        const overviewStyle = getComputedStyle(overview);
        const contentCardStyle = getComputedStyle(contentCard);
        const resizerStyle = getComputedStyle(resizer);
        return {
            overviewPadding: [overviewStyle.paddingTop, overviewStyle.paddingBottom],
            contentCardPadding: [contentCardStyle.paddingTop, contentCardStyle.paddingBottom],
            resizerFontSize: resizerStyle.fontSize,
            numericCells: Array.from(firstRow.querySelectorAll('.trade-transactions-number')).map((cell) => ({
                major: Boolean(cell.querySelector('.workspace-metric-value-major')),
                minor: Boolean(cell.querySelector('.workspace-metric-value-minor')),
            })),
        };
    });

    expect(layout).not.toBeNull();
    expect(layout?.overviewPadding).toEqual(['0px', '0px']);
    expect(layout?.contentCardPadding).toEqual(['6px', '6px']);
    expect(layout?.resizerFontSize).toBe('13px');
    expect(layout?.numericCells.length).toBe(7);
    expect(layout?.numericCells.every((cell) => cell.major && cell.minor)).toBe(true);
});

test('renders the Backtest transaction contract for intraday results', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3d&interval=1m&rise=0.50&fall=1.00');

    const headerCells = page.locator('#backtest_history_table_wrap [data-table-header] thead th');
    await expect(headerCells).toHaveText([
        'No.',
        'Date time',
        'Side',
        'Price',
        'Quantity',
        'Realized P&L',
        'Unrealized P&L',
        'Cash',
        'Market value',
        'Equity',
    ]);

    const firstRow = page.locator('#backtest_history_table_wrap [data-table-body] tbody tr').first();
    await expect(firstRow).toBeVisible();
    await expect(firstRow.locator('td')).toHaveCount(10);
    await expect(firstRow.locator('td').first()).toHaveText('1');
    const selectedInterval = await page.locator('#backtest_interval_control').getAttribute('data-active');
    if (selectedInterval === '1m') {
        await expect(firstRow.locator('.trade-transactions-date')).toHaveText(/\d{2}:\d{2}/);
    }

    const tableGeometry = await page.locator('#backtest_history_table_wrap [data-table-header]').evaluate((table) => ({
        columnCount: table.querySelectorAll('col').length,
        minWidth: Number.parseFloat(getComputedStyle(table).minWidth),
        tableWidth: table.getBoundingClientRect().width,
    }));
    expect(tableGeometry.columnCount).toBe(10);
    expect(tableGeometry.minWidth).toBeGreaterThanOrEqual(900);
    expect(tableGeometry.tableWidth).toBeGreaterThanOrEqual(900);
});

test('removes the glass border color from the shared Backtest Period trigger', async ({page}) => {
    await page.setViewportSize({width: 1033, height: 841});
    await page.goto('/workspaces/backtest?ticker=TQQQ&strategy=grid-trading&stop_loss=0');

    const periodTrigger = page.locator('#period_panel [data-shared-select-trigger]');
    await expect(periodTrigger).toBeVisible();

    const borderState = await periodTrigger.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            borderStyle: style.borderStyle,
            borderWidth: style.borderWidth,
            borderColor: style.borderColor,
        };
    });
    expect(borderState).toEqual({
        borderStyle: 'none',
        borderWidth: '0px',
        borderColor: 'rgba(0, 0, 0, 0)',
    });

    await periodTrigger.hover();
    await expect.poll(() => periodTrigger.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            borderStyle: style.borderStyle,
            borderWidth: style.borderWidth,
            borderColor: style.borderColor,
        };
    })).toEqual({
        borderStyle: 'none',
        borderWidth: '0px',
        borderColor: 'rgba(0, 0, 0, 0)',
    });
});

test('opens Grid Trading private parameters through the shared strategy tune button', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=grid-trading');

    const strategyTrigger = page.locator(
        'xpath=/html/body/main/div/section/section/div/article[1]/form/div[10]/div[1]/div[1]/button',
    );
    const tuneButton = page.locator(
        'xpath=/html/body/main/div/section/section/div/article[1]/form/div[10]/div[1]/button',
    );
    const paramsPanel = page.locator('#trade_strategy_params_panel');

    await expect(strategyTrigger).toHaveText('Grid Trading');
    await expect(tuneButton).toBeVisible();
    await expect(tuneButton).toBeEnabled();
    await expect(tuneButton).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('[data-trade-strategy-field]')).not.toHaveClass(/is-grid-trading-inline/);
    await expect(paramsPanel).toBeHidden();

    await tuneButton.click();
    await expect(tuneButton).toHaveAttribute('aria-expanded', 'true');
    await expect(paramsPanel).toBeVisible();
    for (const key of ['price_floor', 'price_ceiling', 'rise', 'fall']) {
        await expect(page.locator(`[data-strategy-param-key="${key}"]`)).toBeVisible();
    }

    const numericContract = await page.locator('#trade_strategy_params_panel input[type="number"]').evaluateAll((inputs) => (
        inputs.map((input) => {
            const style = getComputedStyle(input);
            return {
                height: style.height,
                minHeight: style.minHeight,
                inputMode: input.getAttribute('inputmode'),
            };
        })
    ));
    expect(numericContract).toHaveLength(4);
    expect(numericContract.every((control) => (
        control.height === '28px'
        && control.minHeight === '28px'
        && ['numeric', 'decimal'].includes(control.inputMode)
    ))).toBe(true);
    await expect(page.locator('#trade_initial_capital')).toHaveAttribute('inputmode', 'decimal');
    await expect(page.locator('#trade_initial_capital')).toHaveCSS('height', '28px');
});

test('waits for Grid Trading parameter blur before recalculating', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    const hydrationRequests = [];
    page.on('request', (request) => {
        if (request.headers()['x-requested-with'] !== 'workspace-hydrate') return;
        if (new URL(request.url()).pathname !== '/workspaces/backtest') return;
        hydrationRequests.push(request.url());
    });

    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=grid-trading&fall=0.50');
    await expect(page.locator('#tradeEquityChart')).toBeVisible();

    await page.locator('[data-trade-strategy-tune-button]').click();
    const fallInput = page.locator('#strategy_param_fall');
    await expect(fallInput).toBeVisible();
    await fallInput.click();
    await fallInput.press('ControlOrMeta+A');
    await fallInput.pressSequentially('1.75');

    await page.waitForTimeout(350);
    expect(hydrationRequests).toHaveLength(0);

    await page.locator('body').click({position: {x: 800, y: 500}});
    await expect.poll(() => hydrationRequests.length).toBe(1);
    await expect(page).toHaveURL(/fall=1\.75/);
});

test('replaces Backtest controls when the strategy changes without losing the ticker', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=grid-trading&stop_loss=0');

    const chooseStrategy = async (strategyId) => {
        const trigger = page.locator('[data-trade-strategy-trigger]');
        await trigger.click();
        const option = page.locator(`[data-trade-strategy-dropdown] [data-value="${strategyId}"]`);
        await expect(option).toHaveCount(1);
        await option.click();
        await expect.poll(() => page.locator('#trade_strategy').inputValue()).toBe(strategyId);
    };

    await expect(page.locator('#ticker_1')).toHaveValue('TQQQ');
    await expect(page.locator('[data-strategy-param-key="price_floor"]')).toHaveCount(1);
    await expect(page.locator('#backtest_interval_control')).toHaveCount(1);
    await expect(page.locator('#stop_loss')).not.toBeChecked();

    await chooseStrategy('dca');
    await expect(page.locator('#ticker_1')).toHaveValue('TQQQ');
    await expect(page.locator('[data-strategy-param-key="frequency"]')).toHaveCount(1);
    await expect(page.locator('[data-strategy-param-key="price_floor"]')).toHaveCount(0);
    await expect(page.locator('#backtest_interval_control')).toHaveCount(0);
    await expect(page.locator('#stop_loss')).toHaveCount(1);
    await expect(page.locator('#stop_loss')).not.toBeChecked();

    await chooseStrategy('grid-trading');
    await expect(page.locator('#ticker_1')).toHaveValue('TQQQ');
    await expect(page.locator('[data-strategy-param-key="price_floor"]')).toHaveCount(1);
    await expect(page.locator('[data-strategy-param-key="frequency"]')).toHaveCount(0);
    await expect(page.locator('#backtest_interval_control')).toHaveCount(1);
});

test('keeps the Grid Trading tuning panel inside the desktop viewport', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 720});
    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=grid-trading&stop_loss=0');

    const tuneButton = page.locator('[data-trade-strategy-tune-button]');
    const paramsPanel = page.locator('#trade_strategy_params_panel');
    await tuneButton.click();
    await expect(paramsPanel).toBeVisible();

    const geometry = await paramsPanel.evaluate((panel) => {
        const panelRect = panel.getBoundingClientRect();
        const anchorRect = panel.closest('[data-trade-strategy-field]')
            ?.querySelector('.trade-strategy-row')
            ?.getBoundingClientRect();
        const numberInputs = Array.from(panel.querySelectorAll('.trade-strategy-number-field'))
            .map((field) => {
                const row = field.querySelector('.trade-strategy-number-row');
                const input = field.querySelector('input[type="number"]');
                const stepper = field.querySelector('.trade-strategy-stepper');
                if (!(field instanceof HTMLElement)
                    || !(row instanceof HTMLElement)
                    || !(input instanceof HTMLElement)
                    || !(stepper instanceof HTMLElement)) return null;
                return {
                    fieldWidth: field.getBoundingClientRect().width,
                    rowWidth: row.getBoundingClientRect().width,
                    inputWidth: input.getBoundingClientRect().width,
                    stepperHidden: getComputedStyle(stepper).visibility === 'hidden',
                };
            })
            .filter(Boolean);
        const inputs = Array.from(panel.querySelectorAll('input, select, button'))
            .filter((node) => node.getClientRects().length > 0)
            .map((node) => {
                const rect = node.getBoundingClientRect();
                return {top: rect.top, bottom: rect.bottom};
            });
        return {
            flipped: panel.classList.contains('is-flipped'),
            panel: {top: panelRect.top, bottom: panelRect.bottom},
            anchor: anchorRect ? {top: anchorRect.top, bottom: anchorRect.bottom} : null,
            numberInputs,
            inputs,
            viewportHeight: window.visualViewport?.height || window.innerHeight,
        };
    });

    expect(geometry.flipped).toBe(true);
    expect(geometry.panel.top).toBeGreaterThanOrEqual(0);
    expect(geometry.panel.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.anchor).not.toBeNull();
    expect(geometry.panel.bottom).toBeLessThanOrEqual((geometry.anchor?.top || 0) - 4);
    expect(geometry.inputs).toHaveLength(12);
    expect(geometry.numberInputs).toHaveLength(4);
    expect(geometry.numberInputs.every((input) => (
        input.stepperHidden
        && input.rowWidth >= input.fieldWidth - 1
        && input.inputWidth >= input.rowWidth - 1
    ))).toBe(true);
    expect(geometry.inputs.every((input) => (
        input.top >= geometry.panel.top
        && input.bottom <= geometry.panel.bottom
        && input.top >= 0
        && input.bottom <= geometry.viewportHeight
    ))).toBe(true);
});

test('keeps narrow Backtest tables scrollable and the section-resizer ARIA state accurate', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 720});
    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=grid-trading&stop_loss=0');
    await page.setViewportSize({width: 390, height: 844});
    const visibleNoticeClose = page.locator('[data-dismissible-notice]:not([hidden]) .notice-close').first();
    if (await visibleNoticeClose.isVisible()) {
        await visibleNoticeClose.click();
    }
    await setSidebarExpanded(page, false);

    const historyShell = page.locator('#backtest_history_table_wrap');
    const historyScroll = page.locator('#backtest_history_table_scroll');
    const headerTable = historyShell.locator('[data-table-header]');
    const resizer = page.locator('#backtest_section_resizer');
    await expect(historyShell).toBeVisible();
    await expect(historyScroll).toBeVisible();
    await expect(resizer).toHaveAttribute('aria-valuenow', /\d+/);

    await expect.poll(() => page.evaluate(() => {
        const scroll = document.getElementById('backtest_history_table_scroll');
        const bodyTable = scroll?.querySelector('[data-table-body]');
        const shell = document.querySelector('#backtest_history_table_wrap');
        const resizerElement = document.getElementById('backtest_section_resizer');
        const overview = document.querySelector('.backtest-trade-performance-card');
        const appShell = document.querySelector('.app-shell');
        if (!scroll || !bodyTable || !shell || !resizerElement || !overview || !appShell) return null;
        const valueNow = Number(resizerElement.getAttribute('aria-valuenow'));
        const valueMin = Number(resizerElement.getAttribute('aria-valuemin'));
        const valueMax = Number(resizerElement.getAttribute('aria-valuemax'));
        return {
            bodyWidth: bodyTable.getBoundingClientRect().width,
            clientWidth: scroll.clientWidth,
            scrollWidth: scroll.scrollWidth,
            viewportWidth: document.documentElement.clientWidth,
            nowrap: getComputedStyle(bodyTable.querySelector('tbody td') || bodyTable).whiteSpace,
            paginationInsideShell: shell.contains(document.getElementById('tradeTransactionsPagination')),
            ariaMatchesOverview: valueNow === Math.round(overview.getBoundingClientRect().height),
            ariaInRange: valueNow >= valueMin && valueNow <= valueMax,
            appShellScrollable: appShell.scrollHeight > appShell.clientHeight,
        };
    })).toEqual(expect.objectContaining({
        bodyWidth: expect.any(Number),
        clientWidth: expect.any(Number),
        scrollWidth: expect.any(Number),
        nowrap: 'nowrap',
        paginationInsideShell: true,
        ariaMatchesOverview: true,
        ariaInRange: true,
        appShellScrollable: true,
    }));

    const tableMetrics = await historyScroll.evaluate((scroll) => ({
        clientWidth: scroll.clientWidth,
        clientHeight: scroll.clientHeight,
        scrollWidth: scroll.scrollWidth,
    }));
    expect(tableMetrics.clientHeight).toBeGreaterThan(0);
    expect(tableMetrics.scrollWidth).toBeGreaterThanOrEqual(720);
    expect(tableMetrics.clientWidth).toBeLessThanOrEqual(390);
    expect(tableMetrics.scrollWidth).toBeGreaterThan(tableMetrics.clientWidth);
    const horizontalOffset = await historyScroll.evaluate((scroll) => {
        scroll.scrollLeft = Math.min(96, scroll.scrollWidth - scroll.clientWidth);
        scroll.dispatchEvent(new Event('scroll'));
        return scroll.scrollLeft;
    });
    expect(horizontalOffset).toBeGreaterThan(0);
    await expect.poll(() => headerTable.evaluate((header) => Number.parseFloat(header.style.translate || '0')))
        .toBe(-horizontalOffset);

    const nestedScrollMoved = await page.evaluate(() => {
        const appShell = document.querySelector('.app-shell');
        if (!appShell) return false;
        const before = appShell.scrollTop;
        appShell.scrollTop = Math.min(appShell.scrollHeight - appShell.clientHeight, before + 120);
        return appShell.scrollTop > before;
    });
    expect(nestedScrollMoved).toBe(true);
});

test('uses the shared 28px numeric control and iPad keyboard contract in Portfolio', async ({page}) => {
    await page.goto('/workspaces/portfolio?ticker=QQQ&ticker=AAPL&weight=60&weight=40&period=1y');

    const numericContract = await page.locator('input[type="number"]').evaluateAll((inputs) => (
        inputs.map((input) => {
            const style = getComputedStyle(input);
            return {
                height: style.height,
                minHeight: style.minHeight,
                inputMode: input.getAttribute('inputmode'),
            };
        })
    ));
    expect(numericContract).toHaveLength(4);
    expect(numericContract.every((control) => (
        control.height === '28px'
        && control.minHeight === '28px'
        && control.inputMode === 'numeric'
    ))).toBe(true);
});

test('keeps the shared dock centered inside the expanded sidebar at intermediate widths', async ({page}) => {
    await mockInvestmentReadApis(page);
    await page.goto('/trade/investment');

    const readDockGeometry = () => page.evaluate(() => {
        const sidebar = document.querySelector('#app_sidebar')?.getBoundingClientRect();
        const dock = document.querySelector('.sidebar-dock')?.getBoundingClientRect();
        if (!sidebar || !dock) return null;
        return {
            centerDelta: Math.abs(
                (dock.left + (dock.width / 2))
                - (sidebar.left + (sidebar.width / 2))
            ),
            dockLeft: dock.left,
            dockRight: dock.right,
            sidebarExpanded: document.querySelector('#sidebar_toggle')?.getAttribute('aria-expanded'),
        };
    });

    for (const width of [601, 744, 755, 767]) {
        await page.setViewportSize({width, height: 675});
        await expect.poll(async () => {
            const geometry = await readDockGeometry();
            return Boolean(
                geometry
                && geometry.sidebarExpanded === 'true'
                && geometry.centerDelta <= 0.5
                && geometry.dockLeft >= 0
                && geometry.dockRight <= width
            );
        }).toBe(true);

        const geometry = await readDockGeometry();
        expect(geometry.centerDelta).toBeLessThanOrEqual(0.5);
        expect(geometry.dockLeft).toBeGreaterThanOrEqual(0);
        expect(geometry.dockRight).toBeLessThanOrEqual(width);
    }
});

test('keeps the narrow-screen sidebar toggle clear of the sidebar edge and theme action', async ({page}) => {
    await page.setViewportSize({width: 375, height: 667});
    await page.goto('/settings/about');

    await page.locator('#sidebar_toggle').click();
    await expect(page.locator('#sidebar_toggle')).toHaveAttribute('aria-expanded', 'true');

    const geometry = () => page.evaluate(() => {
        const rectFor = (selector) => {
            const element = document.querySelector(selector);
            if (!element) return null;
            const {left, right, top, bottom} = element.getBoundingClientRect();
            return {left, right, top, bottom};
        };
        return {
            sidebar: rectFor('#app_sidebar'),
            toggle: rectFor('#sidebar_toggle'),
            theme: rectFor('#global_theme_toggle'),
        };
    });

    await expect.poll(async () => {
        const {sidebar, toggle} = await geometry();
        return sidebar && toggle ? sidebar.right - toggle.right : null;
    }).toBeGreaterThanOrEqual(16);
    await expect.poll(async () => {
        const {theme, toggle} = await geometry();
        return theme && toggle ? theme.left - toggle.right : null;
    }).toBeGreaterThanOrEqual(12);
});

const responsiveViewports = [
    {name: 'iPhone SE', width: 375, height: 667, overlaySidebar: true},
    {name: 'iPhone 15 Pro', width: 393, height: 852, overlaySidebar: true},
    {name: 'iPad mini portrait', width: 744, height: 1133, overlaySidebar: true},
    {name: 'iPad portrait', width: 768, height: 1024, overlaySidebar: true},
    {name: 'iPad Air portrait', width: 820, height: 1180, overlaySidebar: true},
    {name: 'iPad Pro 11 portrait', width: 834, height: 1194, overlaySidebar: true},
    {name: 'iPad landscape', width: 1024, height: 768, overlaySidebar: false},
    {name: 'iPad Pro portrait', width: 1024, height: 1366, overlaySidebar: false},
    {name: 'MacBook Pro 14', width: 1512, height: 982, overlaySidebar: false},
    {name: 'MacBook Pro 16', width: 1728, height: 1117, overlaySidebar: false},
];

for (const viewport of responsiveViewports) {
    test(`keeps the settings workspace operable at ${viewport.name}`, async ({page}) => {
        await page.setViewportSize({width: viewport.width, height: viewport.height});
        await page.goto('/settings/about');

        const layout = await page.evaluate(() => {
            const root = document.documentElement;
            const toggle = document.querySelector('#sidebar_toggle')?.getBoundingClientRect();
            const theme = document.querySelector('#global_theme_toggle')?.getBoundingClientRect();
            const sidebarTitle = document.querySelector('#app_sidebar .hero h1')?.getBoundingClientRect();
            const pageTitle = document.querySelector('.settings-summary-card .report-heading')?.getBoundingClientRect();
            const workspace = document.querySelector('.workspace')?.getBoundingClientRect();
            const dockLabels = [...document.querySelectorAll('.sidebar-dock-label')];
            const centerY = (rect) => rect ? rect.top + (rect.height / 2) : null;
            return {
                overflowX: root.scrollWidth > window.innerWidth + 1,
                sidebarExpanded: document.querySelector('#sidebar_toggle')?.getAttribute('aria-expanded'),
                toggle: toggle ? {width: toggle.width, height: toggle.height, left: toggle.left, right: toggle.right} : null,
                titleCenterDelta: pageTitle && toggle ? Math.abs(centerY(pageTitle) - centerY(toggle)) : null,
                sidebarCenterDelta: sidebarTitle && toggle ? Math.abs(centerY(sidebarTitle) - centerY(toggle)) : null,
                themeCenterDelta: pageTitle && theme ? Math.abs(centerY(pageTitle) - centerY(theme)) : null,
                workspace: workspace ? {width: workspace.width, left: workspace.left, right: workspace.right} : null,
                dockLabels: dockLabels.map((label) => ({
                    text: label.textContent.trim(),
                    visible: getComputedStyle(label).display !== 'none',
                })),
            };
        });

        expect(layout.overflowX).toBe(false);
        expect(layout.toggle).not.toBeNull();
        expect(layout.workspace).not.toBeNull();
        expect(layout.toggle.left).toBeGreaterThanOrEqual(0);
        expect(layout.toggle.right).toBeLessThanOrEqual(viewport.width);
        expect(layout.workspace.right).toBeLessThanOrEqual(viewport.width);
        expect(layout.workspace.width).toBeGreaterThanOrEqual(
            viewport.overlaySidebar ? viewport.width - 24 : (viewport.workspaceMinWidth || 400),
        );
        expect(layout.sidebarExpanded).toBe(viewport.overlaySidebar ? 'false' : 'true');
        expect(layout.dockLabels).toHaveLength(3);
        expect(layout.dockLabels.every((label) => label.text.length > 0)).toBe(true);
        expect(layout.dockLabels.every((label) => label.visible)).toBe(viewport.overlaySidebar);
        if (viewport.overlaySidebar) {
            expect(layout.toggle.width).toBeGreaterThanOrEqual(44);
            expect(layout.toggle.height).toBeGreaterThanOrEqual(44);
        } else if (viewport.width >= 768) {
            expect(layout.titleCenterDelta).toBeLessThanOrEqual(1);
            expect(layout.sidebarCenterDelta).toBeLessThanOrEqual(1);
            expect(layout.themeCenterDelta).toBeLessThanOrEqual(1);
        }
    });
}
