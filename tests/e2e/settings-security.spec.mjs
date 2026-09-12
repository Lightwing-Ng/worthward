/* Browser write and suggestion security regressions. Code version: v1.0.0 */
import {expect, test} from '@playwright/test';

test('native Settings submissions and the global language toggle retain session proof', async ({page}) => {
    await page.goto('/settings/general');
    const form = page.locator('.settings-date-format-form');
    await expect(form.locator('[name="csrf_token"]')).not.toHaveValue('');
    const response = page.waitForResponse((response) => response.url().endsWith('/settings/general/action') && response.request().method() === 'POST');
    await Promise.all([
        page.waitForEvent('domcontentloaded'),
        form.evaluate((form) => form.requestSubmit()),
    ]);
    expect((await response).status()).toBe(303);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#global_language_toggle')).toHaveAttribute('data-bound-language-toggle', '1');
    await page.route('**/api/settings/language/cycle', async (route) => {
        expect(route.request().headers()['x-csrf-token']).toBeTruthy();
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.fulfill({response});
    });
    await page.locator('#global_quick_actions').hover();
    await expect(page.locator('#global_language_toggle')).toHaveCSS('opacity', '1');
    await Promise.all([
        page.waitForResponse('**/api/settings/language/cycle'),
        page.locator('#global_language_toggle').click(),
    ]);
    await page.goto('/settings/general');
    const restored = await page.evaluate(async () => {
        const response = await fetch('/api/settings/language', {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'X-CSRF-Token': window.WORTHWARD_APP.security.investmentCsrfToken},
            body: JSON.stringify({language: 'en'}),
        });
        return response.status;
    });
    expect(restored).toBe(200);
});

for (const workspace of ['comparison', 'live-trading']) {
    test(`${workspace} suggestions render hostile provider fields as text`, async ({page}) => {
        const name = '<img src=x onerror="window.__suggestionInjected=1">';
        const symbol = 'X" data-injected="yes';
        await page.route('**/api/symbol-search**', (route) => route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify([{source: 'remote', symbol, name, logo_url: '/missing" onerror="window.__suggestionInjected=1'}]),
        }));
        if (workspace === 'live-trading') {
            await page.route('**/api/live-trading/positions**', (route) => route.fulfill({
                contentType: 'application/json', body: JSON.stringify({success: true, positions: []}),
            }));
            const response = await page.context().request.post('/trade/live-trading/unlock', {
                form: {pin: process.env.WORTHWARD_LIVE_TRADING_PIN || '123456'},
            });
            expect(response.status()).toBe(200);
            await page.goto('/trade/live-trading');
        } else {
            await page.goto('/workspaces/compare');
        }
        const input = page.locator(workspace === 'live-trading' ? '#live_trading_ticker' : '#ticker_1');
        await input.fill('XYZ');
        const suggestion = page.locator('.suggestion-item').first();
        await expect(suggestion).toBeVisible();
        await expect(suggestion.locator('.suggestion-name')).toHaveText(name);
        await expect(suggestion).toHaveAttribute('data-symbol', symbol);
        await expect(suggestion.locator('[onerror], [data-injected]')).toHaveCount(0);
        expect(await page.evaluate(() => window.__suggestionInjected)).toBeUndefined();
    });
}
