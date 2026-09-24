/* Code version: v1.3.1 */
import {
    expect,
    test,
    readFile,
    openBacktestParameterOverlay,
    fixturePath,
    requireChipFallback,
    setSidebarExpanded,
    tapAtCenter,
    readPriceLogoThemeAlignment,
    recordCostDistributionGuideStrokes,
    fulfillInertPriceLiveResponse,
    mockInvestmentReadApis,
    assertCompleteStandardInvestmentExportPayload,
} from './support.mjs';
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

test('keeps Broker access dropdown options as name-only rows', async ({page}) => {
    await page.goto('/settings/broker-access');

    const trigger = page.locator('[data-shared-select-kind="settings-broker"] [data-shared-select-trigger]');
    await trigger.click();

    const dropdown = page.locator('#selected_broker_dropdown');
    await expect(dropdown).toBeVisible();
    await expect(dropdown.locator('[role="option"]')).toHaveText(['IBKR', 'Longbridge']);
    await expect(dropdown.locator('.trade-strategy-dropdown-desc')).toHaveCount(0);
    await expect(dropdown.locator('.trade-strategy-dropdown-copy')).toHaveCount(0);
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
        name: 'worthward_settings_feedback',
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
        const feedback = card.querySelector('[data-broker-test-feedback]');
        const feedbackIcon = card.querySelector('.settings-broker-test-feedback-icon');
        const feedbackCopy = feedback?.querySelector('span:last-child');
        const form = card.querySelector('.settings-action-package-form');
        const cardBounds = card.getBoundingClientRect();
        const toBounds = (element) => {
            const bounds = element.getBoundingClientRect();
            const styles = getComputedStyle(element);
            return {
                left: bounds.left,
                right: bounds.right,
                top: bounds.top,
                bottom: bounds.bottom,
                width: bounds.width,
                gridColumn: styles.gridColumn,
                gridRow: styles.gridRow,
            };
        };
        return {
            icon: toBounds(icon),
            health: toBounds(health),
            title: toBounds(title),
            feedback: toBounds(feedback),
            feedbackIcon: toBounds(feedbackIcon),
            feedbackCopy: toBounds(feedbackCopy),
            form: toBounds(form),
            card: {left: cardBounds.left, right: cardBounds.right},
        };
    });
    expect(connectionLayout.health.left).toBeGreaterThanOrEqual(connectionLayout.icon.right);
    expect(connectionLayout.health.right).toBeLessThanOrEqual(connectionLayout.title.left);
    expect(connectionLayout.feedback.gridColumn).toContain('1 / -1');
    expect(connectionLayout.feedback.gridRow).toContain('3');
    expect(Math.abs((connectionLayout.feedbackIcon.left + connectionLayout.feedbackIcon.width / 2) - (connectionLayout.icon.left + connectionLayout.icon.width / 2))).toBeLessThanOrEqual(1);
    expect(connectionLayout.feedbackCopy.left).toBeGreaterThanOrEqual(connectionLayout.title.left);
    expect(connectionLayout.feedback.right).toBeLessThanOrEqual(connectionLayout.card.right);
    expect(connectionLayout.feedback.width).toBeGreaterThan(300);
    expect(connectionLayout.feedback.bottom).toBeLessThanOrEqual(connectionLayout.form.top);
    expect(connectionLayout.form.gridRow).toContain('4');
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
        name: 'worthward_settings_feedback',
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
        name: 'worthward_settings_feedback',
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

    const segmented = page.locator('#segmented-control .segmented-control');
    await segmented.getByText('Metrics', {exact: true}).click();
    await expect(segmented.locator('input[value="metrics"]')).toBeChecked();
    await expect.poll(() => segmented.evaluate((shell) => {
        const selected = shell.querySelector('input:checked + span');
        const probe = document.createElement('span');
        probe.style.color = 'var(--mode-switch-label-color-active)';
        shell.append(probe);
        const matchesActiveToken = getComputedStyle(selected).color === getComputedStyle(probe).color;
        probe.remove();
        return matchesActiveToken;
    })).toBe(true);
    const segmentedColors = await segmented.evaluate((shell) => {
        const resolveColor = (value) => {
            const probe = document.createElement('span');
            probe.style.color = value;
            shell.append(probe);
            const color = getComputedStyle(probe).color;
            probe.remove();
            return color;
        };
        return {
            active: getComputedStyle(shell.querySelector('input:checked + span')).color,
            activeToken: resolveColor('var(--mode-switch-label-color-active)'),
            inactive: getComputedStyle(shell.querySelector('input:not(:checked) + span')).color,
            inactiveToken: resolveColor('var(--mode-switch-label-color)'),
        };
    });
    expect(segmentedColors.active).toBe(segmentedColors.activeToken);
    expect(segmentedColors.inactive).toBe(segmentedColors.inactiveToken);
    expect(segmentedColors.active).not.toBe(segmentedColors.inactive);

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
    const liveMarkerContract = await marker.evaluate((element) => {
        const root = getComputedStyle(document.documentElement);
        const core = getComputedStyle(element);
        const outer = getComputedStyle(element, '::before');
        const inner = getComputedStyle(element, '::after');
        const px = (value) => Number.parseFloat(value);
        return {
            coreSize: px(core.width),
            duration: outer.animationDuration,
            innerDelay: inner.animationDelay,
            innerDiameter: px(inner.width),
            innerMinimumDiameter: px(inner.width)
                * Number.parseFloat(root.getPropertyValue('--live-marker-inner-start-scale')),
            innerName: inner.animationName,
            outerDiameter: px(outer.width),
            outerMinimumDiameter: px(outer.width)
                * Number.parseFloat(root.getPropertyValue('--live-marker-outer-start-scale')),
            outerName: outer.animationName,
            ringBorderWidth: px(outer.borderTopWidth),
        };
    });
    expect(liveMarkerContract).toEqual({
        coreSize: 6,
        duration: '1.8s',
        innerDelay: '0.9s',
        innerDiameter: 16,
        innerMinimumDiameter: 6,
        innerName: 'live-marker-breath',
        outerDiameter: 24,
        outerMinimumDiameter: 6,
        outerName: 'live-marker-breath',
        ringBorderWidth: 2,
    });
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
    await expect(stepperInput).toHaveCSS('height', '30px');
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
    await page.evaluate(() => window.localStorage.removeItem('worthward:color-token-overrides'));

    await expect(page.locator('[data-color-token-layout]')).toHaveCount(1);
    await expect(page.locator('.settings-nav-item-color-tokens')).toHaveCount(1);
    await expect(page.locator('[data-color-token-group-link="positive-green"]')).toHaveCount(1);
    await expect(page.locator('[data-color-token-group="positive-green"]')).toHaveCSS('border-radius', '10px');
    await expect(page.locator('[data-color-token-name="--theme-accent-positive"][data-color-token-mode="light"] [data-color-token-value]')).toHaveValue('#16a34a');
    await expect(page.locator('[data-color-token-name="--theme-accent-positive"][data-color-token-mode="dark"] [data-color-token-value]')).toHaveValue('#2fff9c');

    await page.evaluate(() => {
        document.documentElement.dataset.themeMode = 'light';
        document.documentElement.setAttribute('data-theme-override', 'light');
        window.dispatchEvent(new CustomEvent('worthward:theme-mode-change', {detail: {mode: 'light'}}));
    });
    const lightValue = page.locator('[data-color-token-name="--theme-accent-positive"][data-color-token-mode="light"] [data-color-token-value]');
    await lightValue.fill('#123456');
    await expect(lightValue).toHaveValue('#123456');
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--theme-accent-positive').trim())).toBe('#123456');
    await page.locator('[data-color-token-name="--theme-accent-positive"][data-color-token-mode="light"] [data-color-token-reset]').click();
    await expect(lightValue).toHaveValue('#16a34a');
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--theme-accent-positive').trim())).toBe('');
});

test('keeps Settings surfaces on the shared 640px content and 384px control tokens', async ({page}) => {
    test.setTimeout(60_000);
    await page.setViewportSize({width: 1_280, height: 900});

    const widthCases = [
        ['/settings/about', '.about-section'],
        ['/settings/backtest', '.settings-shell-backtest > .settings-content-scrollport > .settings-general-panel'],
        ['/settings/broker-access', '.settings-shell-broker-access .settings-action-package'],
        ['/settings/cash-equivalents', '.cash-equivalents-card'],
        ['/settings/clear-caches', '.settings-shell-clear-caches .settings-action-package'],
        ['/settings/email-smtp', '.settings-shell-email-smtp .settings-action-package'],
        ['/settings/font-tokens', '#primitive-scale'],
        ['/settings/general', '.settings-general-shell > .settings-content-scrollport > .settings-general-panel'],
        ['/settings/investment', '.settings-shell-investment > .settings-content-scrollport > .settings-general-panel'],
        ['/settings/local-market-store', '.settings-shell-local-market-store > .settings-content-scrollport > .local-store-maintain-card'],
        ['/settings/local-market-store', '.settings-shell-local-market-store > .settings-content-scrollport > .local-store-table-shell'],
        ['/settings/material-tokens', '.settings-shell-material-tokens > .settings-summary-card'],
        ['/settings/network', '.settings-shell-network > .settings-content-scrollport > .settings-action-package'],
        ['/settings/network', '.settings-shell-network > .settings-content-scrollport > .settings-general-panel-network'],
        ['/settings/strategies', '.settings-shell-strategies > .settings-summary-card'],
        ['/settings/strategies', '.settings-shell-strategies > .settings-content-scrollport > .settings-summary'],
        ['/settings/strategies', '.settings-shell-strategies > .settings-content-scrollport .settings-strategy-card'],
    ];

    for (const [url, selector] of widthCases) {
        await page.goto(url);
        const width = await page.locator(selector).first().evaluate((element) => element.getBoundingClientRect().width);
        expect(width, `${selector} on ${url}`).toBeCloseTo(640, 0);
    }

    await page.goto('/settings/general');
    const dateControls = await page.locator('.settings-date-format-field [data-shared-select-trigger]').evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().width)
    );
    expect(dateControls).toEqual([384, 384]);

    await page.goto('/settings/font-tokens');
    const fontBorders = await page.locator('.font-token-panel').evaluateAll((elements) =>
        elements.map((element) => getComputedStyle(element).borderTopWidth)
    );
    expect(fontBorders).toEqual(['0px', '0px', '0px']);

    await page.goto('/settings/color-tokens');
    const colorLayout = await page.locator('[data-color-token-layout]').evaluate((layout) => ({
        width: layout.getBoundingClientRect().width,
        children: [...layout.querySelector('.settings-color-token-content').children].map((element) => element.className),
    }));
    expect(colorLayout.width).toBeCloseTo(640, 0);
    expect(colorLayout.children.slice(0, 2)).toEqual([
        'settings-color-token-intro settings-card',
        'settings-color-token-sidebar',
    ]);

    await page.goto('/settings/local-market-store');
    const localStoreWidths = await page.evaluate(() => ({
        summary: document.querySelector('.settings-shell-local-market-store > .settings-content-scrollport > .settings-summary')
            ?.getBoundingClientRect().width ?? 0,
        tableShell: document.querySelector('.settings-shell-local-market-store > .settings-content-scrollport > .local-store-table-shell')
            ?.getBoundingClientRect().width ?? 0,
        tableWrap: document.querySelector('#local_store_table_scroll')?.getBoundingClientRect().width ?? 0,
    }));
    expect(localStoreWidths.summary).toBeCloseTo(640, 0);
    expect(localStoreWidths.tableShell).toBeCloseTo(640, 0);
    expect(localStoreWidths.tableWrap).toBeCloseTo(640, 0);

    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/settings/color-tokens');
    const narrowGeometry = await page.evaluate(() => ({
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        contentWidth: document.querySelector('[data-color-token-layout]')?.getBoundingClientRect().width ?? 0,
        controlWidths: [...document.querySelectorAll('.settings-color-token-value')].map((element) => element.getBoundingClientRect().width),
    }));
    expect(narrowGeometry.documentOverflow).toBeLessThanOrEqual(1);
    expect(narrowGeometry.contentWidth).toBeLessThanOrEqual(370);
    expect(Math.max(...narrowGeometry.controlWidths)).toBeLessThanOrEqual(370);
});

test('shares authoritative strategy categories between Settings and Backtest', async ({page}) => {
    await page.goto('/settings/strategies');
    const settingsGroups = await page.locator('[data-strategy-category]').evaluateAll((groups) => (
        groups.map((group) => ({
            key: group.dataset.strategyCategory,
            ids: [...group.querySelectorAll('[data-strategy-id]')].map((item) => item.dataset.strategyId),
        }))
    ));
    expect(settingsGroups.map((group) => group.key)).toEqual([
        'baseline',
        'investment-automation',
        'technical-analysis',
        'machine-learning',
        'portfolio-rotation',
        'price-field',
    ]);
    expect(settingsGroups.find((group) => group.key === 'baseline')?.ids).toEqual(['buy-and-hold']);
    expect(settingsGroups.find((group) => group.key === 'investment-automation')?.ids).toEqual([
        'grid-trading',
        'dca',
    ]);
    expect(settingsGroups.find((group) => group.key === 'technical-analysis')?.ids).toEqual([
        'macd',
        'supertrend-ai',
        'lorentzian-classification',
    ]);
    expect(settingsGroups.find((group) => group.key === 'price-field')?.ids).toEqual([
        'bayesian-price-field',
        'lstm-price-field',
        'patchtst-price-field',
        'cycle-of-price-action',
        'tsmixer-price-field',
        'nhits-price-field',
        'timexer-price-field',
        'itransformer-price-field',
        'tide-price-field',
        'moderntcn-price-field',
        'tft-price-field',
    ]);
    expect(new Set(settingsGroups.flatMap((group) => group.ids)).size).toBe(19);

    await page.goto('/workspaces/backtest?strategy=buy-and-hold&period=6mo');
    const backtestGroups = await page.locator('#trade_strategy optgroup').evaluateAll((groups) => (
        groups.map((group) => ({
            key: group.dataset.strategyGroup,
            ids: [...group.querySelectorAll('option')].map((option) => option.value),
        }))
    ));
    expect(backtestGroups).toEqual(settingsGroups);
});

test('keeps Settings scrollports and local effects inside their owning surfaces', async ({page}) => {
    await page.setViewportSize({width: 1_280, height: 900});

    await page.goto('/settings/material-tokens');
    const materialOverflow = await page.evaluate(() => ({
        shell: getComputedStyle(document.querySelector('.settings-shell-material-tokens > .settings-content-scrollport > .style-token-shell')).overflow,
        card: getComputedStyle(document.querySelector('.settings-shell-material-tokens .style-token-card')).overflow,
        demo: getComputedStyle(document.querySelector('.settings-shell-material-tokens .style-token-demo')).overflow,
    }));
    expect(materialOverflow).toEqual({shell: 'visible', card: 'visible', demo: 'visible'});

    await page.goto('/settings/network');
    const networkOverflow = await page.evaluate(() => ({
        shell: getComputedStyle(document.querySelector('.settings-shell-network')).overflow,
        scrollport: getComputedStyle(document.querySelector('.settings-shell-network > .settings-content-scrollport')).overflow,
        inset: document.querySelector('.settings-shell-network > .settings-content-scrollport > .settings-action-package').getBoundingClientRect().left
            - document.querySelector('.settings-shell-network > .settings-content-scrollport').getBoundingClientRect().left,
        scrollportInsideShell: (() => {
            const shell = document.querySelector('.settings-shell-network').getBoundingClientRect();
            const scrollport = document.querySelector('.settings-shell-network > .settings-content-scrollport').getBoundingClientRect();
            return scrollport.left >= shell.left - 1 && scrollport.right <= shell.right + 1;
        })(),
        action: getComputedStyle(document.querySelector('.settings-shell-network > .settings-content-scrollport > .settings-action-package')).overflow,
        panel: getComputedStyle(document.querySelector('.settings-shell-network > .settings-content-scrollport > .settings-general-panel-network')).overflow,
        row: getComputedStyle(document.querySelector('.settings-shell-network .settings-service-row')).overflow,
    }));
    expect(networkOverflow).toEqual({
        shell: 'visible',
        scrollport: 'hidden auto',
        inset: 0,
        scrollportInsideShell: true,
        action: 'visible',
        panel: 'visible',
        row: 'clip',
    });

    await page.goto('/settings/strategies');
    const strategyCard = page.locator('.settings-strategy-card').nth(1);
    await strategyCard.locator('summary').click();
    await expect(strategyCard).toHaveAttribute('open', '');
    await expect(strategyCard).toHaveCSS('overflow', 'visible');
    const strategyOverflow = await strategyCard.evaluate((card) => ({
        card: getComputedStyle(card).overflow,
        params: getComputedStyle(card.querySelector('.settings-strategy-params-shell')).overflow,
        table: getComputedStyle(card.querySelector('.settings-strategy-params-table-wrap')).overflow,
    }));
    expect(strategyOverflow).toEqual({card: 'visible', params: 'visible', table: 'auto'});
    await expect(page.locator('.settings-strategy-card').first()).toHaveCSS('overflow', 'visible');
    const strategyShell = await page.evaluate(() => {
        const shell = document.querySelector('.settings-shell-strategies');
        const scrollport = shell.querySelector('.settings-content-scrollport');
        const card = scrollport.querySelector('.settings-strategy-card');
        const rootStyle = getComputedStyle(document.documentElement);
        const shellBounds = shell.getBoundingClientRect();
        const scrollportBounds = scrollport.getBoundingClientRect();
        const cardBounds = card.getBoundingClientRect();
        return {
            shell: getComputedStyle(shell).overflow,
            scrollport: getComputedStyle(scrollport).overflow,
            bleed: parseFloat(rootStyle.getPropertyValue('--layout-physical-effect-bleed')),
            inset: cardBounds.left - scrollportBounds.left,
            rightClearance: scrollportBounds.right - cardBounds.right,
            scrollportExtendsStartEdge: scrollportBounds.left < shellBounds.left - 1,
            scrollportKeepsEndEdge: Math.abs(scrollportBounds.right - shellBounds.right) <= 1,
        };
    });
    expect(strategyShell.shell).toBe('visible');
    expect(strategyShell.scrollport).toBe('hidden auto');
    expect(strategyShell.bleed).toBe(48);
    expect(strategyShell.inset).toBeCloseTo(strategyShell.bleed, 1);
    expect(strategyShell.rightClearance).toBeGreaterThanOrEqual(strategyShell.bleed - 1);
    expect(strategyShell.scrollportExtendsStartEdge).toBe(true);
    expect(strategyShell.scrollportKeepsEndEdge).toBe(true);

    await page.setViewportSize({width: 847, height: 1_116});
    await page.goto('/settings/strategies');
    const annotatedStrategyGeometry = await page.evaluate(() => {
        const scrollport = document.querySelector(
            '.settings-shell-strategies > .settings-content-scrollport',
        );
        const card = scrollport.querySelector('.settings-strategy-card');
        const scrollportBounds = scrollport.getBoundingClientRect();
        const cardBounds = card.getBoundingClientRect();
        return {
            leftClearance: cardBounds.left - scrollportBounds.left,
            documentOverflow: document.documentElement.scrollWidth
                - document.documentElement.clientWidth,
        };
    });
    expect(annotatedStrategyGeometry.leftClearance).toBeCloseTo(48, 1);
    expect(annotatedStrategyGeometry.documentOverflow).toBeLessThanOrEqual(1);

    await page.setViewportSize({width: 390, height: 844});
    for (const url of ['/settings/material-tokens', '/settings/network', '/settings/strategies']) {
        await page.goto(url);
        const narrowOverflow = await page.evaluate(() => ({
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            shellWidth: document.querySelector('#settings_workspace_shell')?.getBoundingClientRect().width ?? 0,
        }));
        expect(narrowOverflow.documentOverflow, `${url} document overflow`).toBeLessThanOrEqual(1);
        expect(narrowOverflow.shellWidth, `${url} shell width`).toBeLessThanOrEqual(370);
    }
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

    const actionPackage = page.locator(
        '.settings-shell-network > .settings-content-scrollport > .settings-action-package',
    ).filter({has: page.locator('[data-network-refresh-button]')});
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
    await page.evaluate(() => window.localStorage.removeItem('worthward:export-image-config:v1'));
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
        const api = window.WORTHWARD_EXPORT_IMAGE;
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
