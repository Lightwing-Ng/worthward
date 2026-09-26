/* Code version: v1.0.1 */
import {expect, test} from '@playwright/test';

const cases = [
    {width: 1006, height: 791, touch: false},
    {width: 390, height: 844, touch: true},
    {width: 1006, height: 500, touch: false},
];

async function measureSurface(surface) {
    return surface.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const close = node.querySelector('.workspace-modal-close, .notice-close');
        const closeRect = close.getBoundingClientRect();
        const icon = node.querySelector('.workspace-modal-icon');
        const iconRect = icon.getBoundingClientRect();
        const heading = node.querySelector('.workspace-modal-title, .notice-floating-banner-heading');
        const body = node.querySelector('.workspace-modal-copy, .notice-floating-banner-copy, .notice-floating-banner-list');
        const headingRect = heading.getBoundingClientRect();
        const bodyRect = body.getBoundingClientRect();
        const probe = document.createElement('span');
        probe.style.cssText = [
            'background:var(--frosted-glass-notice-background)',
            'border:var(--frosted-glass-notice-border)',
            'box-shadow:var(--frosted-glass-notice-shadow)',
            'backdrop-filter:var(--frosted-glass-notice-blur)',
            'color:var(--muted)',
        ].join(';');
        node.appendChild(probe);
        const probeStyle = getComputedStyle(probe);
        const material = (value) => ({
            background: value.backgroundColor,
            gradient: value.backgroundImage,
            border: value.border,
            shadow: value.boxShadow,
            blur: value.backdropFilter,
        });
        const result = {
            width: rect.width,
            centerX: rect.left + rect.width / 2,
            centerY: rect.top + rect.height / 2,
            closeCenterTop: closeRect.top + closeRect.height / 2 - rect.top,
            closeCenterLeft: closeRect.left + closeRect.width / 2 - rect.left,
            headingCenter: headingRect.top + headingRect.height / 2 - rect.top,
            headingHeight: headingRect.height,
            headingTop: headingRect.top,
            headingBottom: headingRect.bottom,
            closeTop: closeRect.top,
            closeRight: closeRect.right,
            headingLeft: headingRect.left,
            bodyLeft: bodyRect.left,
            iconLeft: iconRect.left,
            iconWidth: iconRect.width,
            bodyTop: bodyRect.top,
            iconTop: iconRect.top,
            headingWeight: getComputedStyle(heading).fontWeight,
            headingSize: getComputedStyle(heading).fontSize,
            headingLineHeight: getComputedStyle(heading).lineHeight,
            bodyWeight: getComputedStyle(body).fontWeight,
            bodySize: getComputedStyle(body).fontSize,
            bodyLineHeight: getComputedStyle(body).lineHeight,
            bodyColor: getComputedStyle(body).color,
            mutedColor: probeStyle.color,
            material: material(style),
            tokenMaterial: material(probeStyle),
            afterContent: getComputedStyle(node, '::after').content,
            overflow: node.scrollWidth - node.clientWidth,
            documentOverflow: document.documentElement.scrollWidth - innerWidth,
        };
        probe.remove();
        return result;
    });
}

function expectGeometry(measurement) {
    expect(Math.abs(measurement.closeCenterTop - measurement.closeCenterLeft)).toBeLessThanOrEqual(1);
    if (measurement.headingHeight <= 24) {
        expect(Math.abs(measurement.headingCenter - measurement.closeCenterTop)).toBeLessThanOrEqual(1);
    } else {
        // A wrapped title grows its row without moving the equal-inset dismiss target.
        expect(Math.abs(measurement.headingTop - measurement.closeTop)).toBeLessThanOrEqual(1);
    }
    expect(measurement.headingLeft).toBeGreaterThanOrEqual(measurement.closeRight + 12);
    expect(measurement.bodyTop).toBeGreaterThanOrEqual(measurement.headingBottom + 4);
    expect(Math.abs(measurement.bodyTop - measurement.iconTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(measurement.headingLeft - measurement.bodyLeft)).toBeLessThanOrEqual(1);
    expect(measurement.headingLeft - measurement.iconLeft - measurement.iconWidth).toBeCloseTo(12, 0);
    expect(measurement.iconWidth).toBe(36);
    expect(measurement.headingWeight).toBe('600');
    expect(measurement.headingSize).toBe('15px');
    expect(measurement.headingLineHeight).toBe('18px');
    expect(measurement.bodyWeight).toBe('400');
    expect(measurement.bodySize).toBe('15px');
    expect(measurement.bodyLineHeight).toBe('21.75px');
    expect(measurement.material).toEqual(measurement.tokenMaterial);
    expect(measurement.material.blur).toBe('saturate(1.6) blur(18px)');
    expect(measurement.afterContent).toBe('none');
    expect(measurement.overflow).toBeLessThanOrEqual(1);
    expect(measurement.documentOverflow).toBeLessThanOrEqual(1);
}

function expectApprovedMaterial(measurement, theme) {
    if (theme === 'light') {
        expect(measurement.material.background).toBe('rgba(255, 255, 255, 0.08)');
        expect(measurement.material.gradient).toBe('linear-gradient(rgba(255, 255, 255, 0.24) 0%, rgba(248, 249, 250, 0.18) 100%), none');
        expect(measurement.material.border).toBe('1px solid rgba(255, 255, 255, 0.3)');
        expect(measurement.material.shadow).toContain('rgba(10, 14, 25, 0.12) 0px 18px 40px 0px');
        expect(measurement.material.shadow).toContain('color(srgb 1 1 1 / 0.28549)');
    } else {
        expect(measurement.material.background).toBe('rgba(10, 14, 20, 0.06)');
        expect(measurement.material.gradient).toBe('linear-gradient(rgba(72, 88, 112, 0.18) 0%, rgba(42, 48, 64, 0.133) 100%), none');
        expect(measurement.material.border).toBe('1px solid rgba(210, 224, 244, 0.224)');
        expect(measurement.material.shadow).toContain('rgba(0, 0, 0, 0.22) 0px 18px 40px 0px');
        expect(measurement.material.shadow).toContain('color(srgb 1 1 1 / 0.0282353)');
    }
}

async function measurePinAdapter(dialog) {
    return dialog.evaluate((node) => {
        const style = getComputedStyle(node);
        const overlay = node.closest('.workspace-modal-overlay');
        const probe = document.createElement('span');
        probe.style.background = 'var(--glass-surface-background-soft)';
        node.appendChild(probe);
        const result = {
            material: {
                background: style.backgroundColor,
                gradient: style.backgroundImage,
                border: style.border,
                shadow: style.boxShadow,
                blur: style.backdropFilter,
            },
            padding: style.padding,
            columnCount: style.gridTemplateColumns.split(' ').length,
            gap: style.gap,
            overlayBackground: getComputedStyle(overlay).backgroundColor,
            softBackground: getComputedStyle(probe).backgroundColor,
            overlayBlur: getComputedStyle(overlay).backdropFilter,
            afterContent: getComputedStyle(node, '::after').content,
            width: node.getBoundingClientRect().width,
            overflow: node.scrollWidth - node.clientWidth,
            documentOverflow: document.documentElement.scrollWidth - innerWidth,
        };
        probe.remove();
        return result;
    });
}

for (const viewport of cases) {
    for (const theme of ['light', 'dark']) {
        test(`waiting notification and catalog reuse the approved hierarchy at ${viewport.width}x${viewport.height} ${theme}`, async ({browser}, testInfo) => {
            const context = await browser.newContext({
                baseURL: 'http://127.0.0.1:8699',
                viewport: {width: viewport.width, height: viewport.height},
                hasTouch: viewport.touch,
                colorScheme: theme,
                reducedMotion: 'reduce',
            });
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await page.goto('/settings/style-tokens');
            await page.evaluate((value) => {
                document.documentElement.dataset.themeOverride = value;
            }, theme);
            await page.evaluate(() => document.fonts.ready);

            const overlay = page.locator('#workspace_modal_overlay');
            await expect(overlay).toHaveAttribute('role', 'dialog');
            await expect(overlay).toHaveAttribute('aria-modal', 'true');
            await expect(overlay).toHaveAttribute('aria-labelledby', 'workspace_modal_overlay_title');
            await expect(overlay).toHaveAttribute('aria-describedby', 'workspace_modal_overlay_copy');
            // Reveal the production element without starting an import, order, or cache mutation.
            await overlay.evaluate((node) => { node.hidden = false; });
            const waiting = overlay.locator('.workspace-modal-dialog');
            await expect(waiting).toBeVisible();
            await expect(waiting).toHaveCSS('padding', '12px');
            await expect(waiting).toHaveCSS('border-radius', '10px');
            await expect(waiting.locator('.workspace-modal-close .icon')).toHaveCSS('width', '12px');
            const measurement = await measureSurface(waiting);
            expectGeometry(measurement);
            expectApprovedMaterial(measurement, theme);
            expect(measurement.bodyColor).toBe(measurement.mutedColor);
            expect(Math.abs(measurement.centerX - viewport.width / 2)).toBeLessThanOrEqual(1);
            expect(Math.abs(measurement.centerY - viewport.height / 2)).toBeLessThanOrEqual(1);
            expect(measurement.width).toBe(Math.min(420, viewport.width - 32));
            await page.screenshot({path: testInfo.outputPath('waiting-notification.png')});
            const close = waiting.locator('.workspace-modal-close');
            if (viewport.touch) await expect(close).toHaveCSS('opacity', '1');
            else {
                await page.mouse.move(0, 0);
                await expect(close).toHaveCSS('opacity', '0');
                await waiting.hover();
                await expect(close).toHaveCSS('opacity', '1');
            }
            await close.focus();
            await expect(close).toHaveCSS('color', theme === 'dark' ? 'rgb(239, 68, 68)' : 'rgb(200, 30, 30)');
            await waiting.locator('.workspace-modal-title').evaluate((node) => {
                node.textContent = 'A long local waiting title wraps completely inside the same approved notification surface';
            });
            await waiting.locator('.workspace-modal-copy').evaluate((node) => {
                node.textContent = '/a/very/long/unbroken/local/path/that/must/not/escape/the/approved/notification/surface';
            });
            expectGeometry(await measureSurface(waiting));
            await close.press('Enter');
            await expect(overlay).toBeHidden();

            for (const id of ['modal-dialog', 'modal-dialog-banner-message']) {
                const specimen = page.locator(`#${id} .style-token-modal-demo`);
                const specimenMeasurement = await measureSurface(specimen);
                expectGeometry(specimenMeasurement);
                expectApprovedMaterial(specimenMeasurement, theme);
                expect(specimenMeasurement.bodyColor).toBe(specimenMeasurement.mutedColor);
            }
            const banner = page.locator('#modal-dialog-banner-message .style-token-modal-demo');
            await banner.locator('.notice-floating-banner-content').evaluate((node) => {
                node.innerHTML = '<p class="notice-floating-banner-heading">Working locally</p><p class="notice-floating-banner-copy">Supporting copy wraps around a long local-only path: /a/very/long/unbroken/local/path/that/must/not/escape/the/approved/notification/surface.</p>';
            });
            const paragraphMeasurement = await measureSurface(banner);
            expectGeometry(paragraphMeasurement);
            expect(paragraphMeasurement.bodyColor).toBe(paragraphMeasurement.mutedColor);

            // Reveal the existing feedback shell with neutral text, without importing broker data.
            const investmentResponse = page.waitForResponse((response) => (
                new URL(response.url()).pathname === '/api/investment/transactions'
                && response.request().method() === 'GET'
            ));
            await page.goto('/trade/investment');
            await investmentResponse;
            // Initial rendering owns and clears the feedback shell before the test uses it.
            await expect(page.locator('#workspace_modal_overlay')).toBeHidden();
            await page.evaluate((value) => {
                document.documentElement.dataset.themeOverride = value;
            }, theme);
            await page.evaluate(() => document.fonts.ready);
            const feedback = page.locator('#investment_import_feedback');
            await feedback.locator('.notice-floating-banner-content').evaluate((node) => {
                node.innerHTML = '<p class="notice-floating-banner-heading">Local feedback</p><ol class="notice-floating-banner-list investment-import-feedback-list"><li>Ordinary supporting copy remains muted.</li><li><strong>Semantic emphasis</strong> and <span class="notice-floating-banner-emphasis-danger"><u>Review required</u></span> keep their separate state colors.</li></ol>';
            });
            await feedback.evaluate(async (node) => {
                node.hidden = false;
                // Measure settled geometry, not the owned drop-in animation's scaled frame.
                await Promise.all(node.getAnimations().map((animation) => animation.finished));
            });
            const feedbackMeasurement = await measureSurface(feedback);
            expectGeometry(feedbackMeasurement);
            expectApprovedMaterial(feedbackMeasurement, theme);
            expect(feedbackMeasurement.bodyColor).toBe(feedbackMeasurement.mutedColor);
            await expect(feedback.locator('.investment-import-feedback-list strong')).toHaveCSS('font-weight', '700');
            const dangerColor = await feedback.locator('.notice-floating-banner-emphasis-danger').evaluate((node) => getComputedStyle(node).color);
            expect(dangerColor).not.toBe(feedbackMeasurement.mutedColor);
            expect(feedbackMeasurement.width).toBeLessThanOrEqual(460);
            if (viewport.width > 500) expect(feedbackMeasurement.width).toBe(460);

            // The standalone PIN adapter inherits only the material, not the notification grid.
            const unlockPosts = [];
            page.on('request', (request) => {
                if (request.method() === 'POST' && request.url().includes('/trade/live-trading/unlock')) {
                    unlockPosts.push(request.url());
                }
            });
            await page.goto('/trade/live-trading');
            await page.evaluate((value) => {
                document.documentElement.dataset.themeOverride = value;
            }, theme);
            await page.evaluate(() => document.fonts.ready);
            const pin = page.locator('.live-trading-pin-dialog');
            await expect(pin).toBeVisible();
            await expect(pin).toHaveAttribute('aria-labelledby', 'live_trading_pin_title');
            await expect(pin).toHaveAttribute('aria-describedby', 'live_trading_pin_copy');
            const pinMeasurement = await measurePinAdapter(pin);
            expectApprovedMaterial(pinMeasurement, theme);
            expect(pinMeasurement.material.blur).toBe('saturate(1.6) blur(18px)');
            expect(pinMeasurement.padding).toBe(viewport.width <= 420 ? '20px' : '24px');
            expect(pinMeasurement.columnCount).toBe(1);
            expect(pinMeasurement.gap).toBe('0px');
            expect(pinMeasurement.width).toBe(viewport.width <= 420 ? viewport.width - 24 : 392);
            expect(pinMeasurement.overlayBackground).toBe(pinMeasurement.softBackground);
            expect(pinMeasurement.overlayBlur).toBe('none');
            expect(pinMeasurement.afterContent).toBe('none');
            expect(pinMeasurement.overflow).toBeLessThanOrEqual(1);
            expect(pinMeasurement.documentOverflow).toBeLessThanOrEqual(1);
            await expect(pin.locator('.live-trading-pin-slot')).toHaveCount(6);
            await expect(pin.locator('#live_trading_pin')).toHaveValue('');
            await expect(pin.locator('#live_trading_pin_submit')).toBeDisabled();
            await expect(pin.locator('.workspace-modal-close')).toHaveAttribute('href', '/trade/investment');
            expect(unlockPosts).toEqual([]);
            expect(errors).toEqual([]);
            await context.close();
        });
    }
}

test('system dark and manual Light resolve the production notification material independently', async ({browser}) => {
    const context = await browser.newContext({
        baseURL: 'http://127.0.0.1:8699',
        viewport: {width: 1006, height: 791},
        colorScheme: 'dark',
        reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.goto('/settings/style-tokens');
    await page.evaluate(() => document.fonts.ready);
    const overlay = page.locator('#workspace_modal_overlay');
    await overlay.evaluate((node) => { node.hidden = false; });
    const waiting = overlay.locator('.workspace-modal-dialog');
    expectApprovedMaterial(await measureSurface(waiting), 'dark');
    await page.evaluate(() => {
        document.documentElement.dataset.themeOverride = 'light';
    });
    expectApprovedMaterial(await measureSurface(waiting), 'light');
    await context.close();
});
