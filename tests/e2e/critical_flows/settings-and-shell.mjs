/* Code version: v1.1.1 */
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

    await expect(page.locator('.settings-language-options .settings-general-option-title').nth(2))
        .toHaveText('简体中文(中国大陆)');
    await expect(page.locator('.settings-language-header-label').nth(2))
        .toHaveText('简体中文(中国大陆)');
    await expect(page.locator('input[name="translation_zh_hans_cn"]').first())
        .toHaveAttribute('aria-label', '简体中文(中国大陆) 1');

    const tabs = page.locator('.settings-language-tabs');
    await expect(tabs).toHaveCount(1);
    await expect(tabs).toHaveClass(/segmented-control--tabs/);
    await expect(tabs).toHaveAttribute('data-active', 'current');
    await expect(tabs).toHaveAttribute('data-option-count', '2');
    const slider = await tabs.evaluate((element) => {
        const shell = getComputedStyle(element);
        const thumb = getComputedStyle(element, '::before');
        const options = Array.from(element.querySelectorAll('.segmented-control-option'));
        return {
            backdropFilter: shell.backdropFilter || shell.webkitBackdropFilter,
            thumbBackground: thumb.backgroundColor,
            optionTags: options.map((option) => option.tagName),
            activeTextWeight: getComputedStyle(options[0].querySelector('span')).fontWeight,
            inactiveTextWeight: getComputedStyle(options[1].querySelector('span')).fontWeight,
        };
    });
    expect(slider.backdropFilter).toContain('blur');
    expect(slider.thumbBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(slider.optionTags).toEqual(['BUTTON', 'BUTTON']);
    expect(slider.activeTextWeight).toBe('700');
    expect(slider.inactiveTextWeight).toBe('400');

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
    await expect(tabs).toHaveAttribute('data-active', 'history');
    await expect(page.locator('[data-language-panel="history"]')).toBeVisible();
    expect(await tabs.evaluate((element) => element.dataset.segmentedActiveIndex)).toBe('1');

    await page.goto('/settings/general?tab=history');
    await expect(tabs).toHaveAttribute('data-active', 'history');
    await expect(historyTab).toHaveAttribute('aria-selected', 'true');
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

test('shows the standalone primary button specimen alongside the shared Secondary button', async ({page}) => {
    await page.goto('/settings/style-tokens');

    const primaryCard = page.locator('[data-style-token-card="primary-button"]');
    const primary = primaryCard.locator('.style-token-demo > button');
    const secondaryCard = page.locator('[data-style-token-card="secondary-button"]');
    const secondary = secondaryCard.locator('.style-token-demo > button');

    await expect(primaryCard).toHaveCount(1);
    await expect(primary).toHaveText('Maintain all data');
    await expect(primary).toHaveClass(/settings-inline-button-primary/);
    await expect(primary).not.toHaveClass(/secondary-button/);
    await expect(secondaryCard.locator('.style-token-title')).toHaveText('Secondary button');
    await expect(secondary).toHaveClass(/secondary-button/);

    const state = await page.evaluate(() => {
        const primaryButton = document.querySelector('[data-style-token-card="primary-button"] .style-token-demo > button');
        const button = document.querySelector('[data-style-token-card="secondary-button"] .style-token-demo > button');
        if (!(primaryButton instanceof HTMLElement) || !(button instanceof HTMLElement)) return null;
        const primaryStyle = getComputedStyle(primaryButton);
        const style = getComputedStyle(button);
        return {
            primaryFontWeight: primaryStyle.fontWeight,
            primaryBorderWidth: primaryStyle.borderTopWidth,
            background: style.backgroundColor,
            color: style.color,
            borderWidth: style.borderTopWidth,
            fontWeight: style.fontWeight,
            radius: style.borderTopLeftRadius,
            minHeight: style.minHeight,
        };
    });

    expect(state).not.toBeNull();
    expect(state.primaryFontWeight).toBe('500');
    expect(state.primaryBorderWidth).toBe('0px');
    expect(state.borderWidth).toBe('1px');
    expect(state.fontWeight).toBe('600');
    expect(state.radius).toBe('999px');
    expect(state.minHeight).toBe('32px');

    const closeControls = [
        page.locator('[data-style-token-card="modal-dialog"] .workspace-modal-close'),
        page.locator('[data-style-token-card="modal-dialog-banner-message"] .notice-close'),
    ];
    for (const closeControl of closeControls) {
        await closeControl.locator('..').hover();
        await expect(closeControl).toHaveCSS('opacity', '1');
        const closeState = await closeControl.evaluate((element) => {
            const style = getComputedStyle(element);
            return {
                background: style.backgroundColor,
                boxShadow: style.boxShadow,
                outlineStyle: style.outlineStyle,
            };
        });
        expect(closeState.background).toBe('rgba(0, 0, 0, 0)');
        expect(closeState.boxShadow).toBe('none');
        expect(closeState.outlineStyle).toBe('none');
    }

    await page.setViewportSize({width: 390, height: 844});
    await page.reload();
    const narrowState = await page.evaluate(() => {
        const primaryButton = document.querySelector('[data-style-token-card="primary-button"] .style-token-demo > button');
        const secondaryButton = document.querySelector('[data-style-token-card="secondary-button"] .style-token-demo > button');
        const primaryRect = primaryButton?.getBoundingClientRect();
        const secondaryRect = secondaryButton?.getBoundingClientRect();
        return {
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            primaryWidth: primaryRect?.width ?? 0,
            secondaryWidth: secondaryRect?.width ?? 0,
        };
    });
    expect(narrowState.documentOverflow).toBeLessThanOrEqual(1);
    expect(narrowState.primaryWidth).toBeGreaterThan(0);
    expect(narrowState.secondaryWidth).toBeGreaterThan(0);
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

    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3d&strategy=supertrend-ai&interval=1m&stop_loss=0');
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

    const numericValues = await page.locator(
        '.style-token-holdings-allocation-badge-demo [data-numeric-display-value]',
    ).evaluateAll((elements) => elements.map((element) => ({
        value: element.dataset.numericDisplayValue,
        accessibleValue: element.getAttribute('aria-label'),
        fragmentsAreVisualOnly: Array.from(element.children)
            .every((child) => child.getAttribute('aria-hidden') === 'true'),
        text: element.textContent.replace(/\s+/g, ''),
        major: element.querySelector(':scope > .workspace-metric-value-major')?.textContent ?? null,
        minor: element.querySelector(':scope > .workspace-metric-value-minor')?.textContent ?? null,
        suffix: element.querySelector(':scope > .workspace-metric-value-suffix')?.textContent ?? null,
        rightOverflow: element.getBoundingClientRect().right
            - element.closest('.style-token-holdings-allocation-badge-demo').getBoundingClientRect().right,
    })));
    expect(numericValues).toHaveLength(12);
    numericValues.forEach((item) => {
        expect(item.text).toBe(item.value);
        expect(item.accessibleValue).toBe(item.value);
        expect(item.fragmentsAreVisualOnly).toBe(true);
        expect(item.major).not.toBeNull();
        expect(item.minor).toMatch(/^\.\d+$/);
        expect(item.suffix).toBe(item.value.endsWith('%') ? '%' : null);
        expect(item.rightOverflow).toBeLessThanOrEqual(1);
    });

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

test('keeps the canonical shared primitives aligned across themes and narrow layout', async ({page}) => {
    for (const width of [1024, 390]) {
        await page.setViewportSize({width, height: 844});
        await page.goto('/settings/style-tokens');
        for (const theme of ['light', 'dark']) {
            await page.evaluate((nextTheme) => {
                document.documentElement.setAttribute('data-theme-override', nextTheme);
            }, theme);

            const circular = page.locator('[data-style-token-card="circular-icon-button"] .circular-icon-button').first();
            await expect(circular).toBeVisible();
            const circularGeometry = await circular.evaluate((button) => {
                const icon = button.querySelector('.icon');
                const buttonRect = button.getBoundingClientRect();
                const iconRect = icon?.getBoundingClientRect();
                return {
                    width: buttonRect.width,
                    height: buttonRect.height,
                    iconWidth: iconRect?.width ?? 0,
                    iconHeight: iconRect?.height ?? 0,
                    radius: getComputedStyle(button).borderRadius,
                };
            });
            expect(circularGeometry).toEqual({
                width: width <= 900 ? 44 : 36,
                height: width <= 900 ? 44 : 36,
                iconWidth: 18,
                iconHeight: 18,
                radius: '999px',
            });

            const pagination = page.locator('[data-style-token-card="pagination"] .local-store-pagination');
            const previous = pagination.locator('.local-store-page-nav').first();
            await previous.scrollIntoViewIfNeeded();
            await page.mouse.move(0, 0);
            await page.evaluate(() => {
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            });
            const expectedColors = await page.evaluate(() => Object.fromEntries([
                ['default', 'var(--local-store-pagination-button-color)'],
                ['accent', 'var(--local-store-pagination-button-color-hover)'],
            ].map(([name, value]) => {
                const probe = document.createElement('span');
                probe.style.color = value;
                document.body.append(probe);
                const color = getComputedStyle(probe).color;
                probe.remove();
                return [name, color];
            })));
            await expect.poll(() => previous.evaluate((button) => getComputedStyle(button).color)).toBe(expectedColors.default);
            await previous.hover();
            await expect.poll(() => previous.evaluate((button) => getComputedStyle(button).color)).toBe(expectedColors.accent);
            expect(expectedColors.accent).not.toBe(expectedColors.default);
            await page.mouse.move(0, 0);
            await previous.focus();
            await expect.poll(() => previous.evaluate((button) => getComputedStyle(button).color)).toBe(expectedColors.accent);

            const segmented = page.locator('[data-style-token-card="segmented-control"] .segmented-control');
            const segmentedGeometry = await segmented.evaluate((shell) => {
                const shellRect = shell.getBoundingClientRect();
                const ownerRect = shell.parentElement?.getBoundingClientRect();
                const options = Array.from(shell.querySelectorAll('.segmented-control-option'));
                const optionRects = options.map((option) => option.getBoundingClientRect());
                return {
                    shellWidth: shellRect.width,
                    ownerWidth: ownerRect?.width ?? shellRect.width,
                    centerDelta: ownerRect
                        ? Math.abs((shellRect.left + (shellRect.width / 2)) - (ownerRect.left + (ownerRect.width / 2)))
                        : Number.POSITIVE_INFINITY,
                    optionWidths: optionRects.map((rect) => rect.width),
                    optionCenterDeltas: options.map((option, index) => {
                        const rect = optionRects[index];
                        const labelRect = option.querySelector('span')?.getBoundingClientRect();
                        return labelRect
                            ? Math.abs((rect.left + (rect.width / 2)) - (labelRect.left + (labelRect.width / 2)))
                            : Number.POSITIVE_INFINITY;
                    }),
                };
            });
            expect(segmentedGeometry.shellWidth).toBeLessThanOrEqual(segmentedGeometry.ownerWidth);
            expect(segmentedGeometry.centerDelta).toBeLessThanOrEqual(1);
            expect(Math.max(...segmentedGeometry.optionWidths) - Math.min(...segmentedGeometry.optionWidths)).toBeLessThanOrEqual(1);
            expect(Math.max(...segmentedGeometry.optionCenterDeltas)).toBeLessThanOrEqual(1);

            const tableState = await page.locator('[data-style-token-card="scrollable-table"] .scrollable-data-table-shell').evaluate((shell) => ({
                directChildren: Array.from(shell.children, (child) => ({
                    overlay: child.matches('[data-table-visual-overlay]'),
                    header: child.matches('table.scrollable-data-table[data-table-header]'),
                    scroll: child.matches('.scrollable-data-table-scroll[data-table-scroll]'),
                    pagination: child.matches('.local-store-pagination.local-store-pagination--floating'),
                })),
                hasBody: Boolean(shell.querySelector(':scope > [data-table-scroll] > table.scrollable-data-table[data-table-body]')),
            }));
            const overlayIndex = tableState.directChildren.findIndex((child) => child.overlay);
            const headerIndex = tableState.directChildren.findIndex((child) => child.header);
            const scrollIndex = tableState.directChildren.findIndex((child) => child.scroll);
            const paginationIndex = tableState.directChildren.findIndex((child) => child.pagination);
            expect(overlayIndex).toBe(0);
            expect(headerIndex).toBeGreaterThan(overlayIndex);
            expect(scrollIndex).toBeGreaterThan(headerIndex);
            expect(paginationIndex).toBeGreaterThan(scrollIndex);
            expect(tableState.hasBody).toBe(true);
            expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
        }
    }

    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.reload();
    const reducedMotionDurations = await page.locator('[data-style-token-card="pagination"] .local-store-page-nav').first().evaluate((button) => (
        getComputedStyle(button).transitionDuration.split(',').map((duration) => Number.parseFloat(duration))
    ));
    expect(Math.max(...reducedMotionDurations)).toBeLessThanOrEqual(0.001);
});

test('keeps the Style token segmented control at 32px without an outer border', async ({page}) => {
    await page.goto('/settings/style-tokens');

    const rangeShell = page.locator('[data-style-token-card="segmented-control"] .range-mode-shell');
    await expect(rangeShell).toHaveCSS('height', '32px');
    await expect(rangeShell).toHaveCSS('border-top-width', '0px');
    await expect(rangeShell).toHaveCSS('border-right-width', '0px');
    await expect(rangeShell).toHaveCSS('border-bottom-width', '0px');
    await expect(rangeShell).toHaveCSS('border-left-width', '0px');
    const compactGeometry = await rangeShell.evaluate((element) => {
        const shellRect = element.getBoundingClientRect();
        const demoRect = element.parentElement?.getBoundingClientRect();
        const optionWidths = Array.from(element.querySelectorAll('.range-mode-option'))
            .map((option) => option.getBoundingClientRect().width);
        return {
            shellWidth: shellRect.width,
            demoWidth: demoRect?.width ?? shellRect.width,
            centerDelta: demoRect
                ? Math.abs((shellRect.left + (shellRect.width / 2)) - (demoRect.left + (demoRect.width / 2)))
                : Number.POSITIVE_INFINITY,
            optionWidths,
        };
    });
    expect(compactGeometry.shellWidth).toBeLessThan(compactGeometry.demoWidth);
    expect(compactGeometry.centerDelta).toBeLessThanOrEqual(1);
    expect(Math.max(...compactGeometry.optionWidths) - Math.min(...compactGeometry.optionWidths)).toBeLessThanOrEqual(1);
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
    await expect(dropdown.locator('[role="option"]')).toHaveCount(12);
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
    expect(hoverState?.fontFamily).toContain('Univers Next for HSBC');

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
        reduced: window.WorthwardMotion?.reducedMotionQuery.matches,
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
