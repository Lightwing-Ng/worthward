/* Code version: v1.2.0 */
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

test('keeps Investment import physical effects inside the shared scrollport clearance', async ({page}) => {
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await mockInvestmentReadApis(page, {
        transactions: [],
        brokerSummaries: {},
    });

    for (const viewport of [
        {width: 1_280, height: 420},
        {width: 600, height: 1_222},
        {width: 390, height: 844},
    ]) {
        await page.setViewportSize(viewport);
        await page.goto('/trade/investment?view=holdings');
        await page.locator('#toggle_form_button').click();
        await page.locator('#investment_import_broker').evaluate((select) => {
            select.value = 'ibkr';
            select.dispatchEvent(new Event('change', {bubbles: true}));
        });
        await expect(page.locator('#investment_import_ibkr_fields')).toBeVisible();

        const trigger = page.locator(
          '[data-shared-select-kind="investment-import-broker"] [data-shared-select-trigger]',
        );
        await trigger.hover();

        const geometry = await page.locator('#investment_form').evaluate((form) => {
            const stack = form.querySelector('.investment-import-stack');
            const broker = form.querySelector('[data-shared-select-kind="investment-import-broker"]');
            const brokerTrigger = broker?.querySelector('[data-shared-select-trigger]');
            const fieldGroup = form.querySelector('#investment_import_ibkr_fields');
            const cards = [...form.querySelectorAll(
              '#investment_import_ibkr_fields [data-ibkr-import-mode-panel="csv"] .investment-import-bridge-field',
            )];
            if (!(stack instanceof HTMLElement)
                || !(broker instanceof HTMLElement)
                || !(brokerTrigger instanceof HTMLElement)
                || !(fieldGroup instanceof HTMLElement)
                || cards.length !== 2) return null;

            const stackRect = stack.getBoundingClientRect();
            const triggerRect = brokerTrigger.getBoundingClientRect();
            const cardRects = cards.map((card) => card.getBoundingClientRect());
            const stackStyle = getComputedStyle(stack);
            return {
                formOverflow: getComputedStyle(form).overflow,
                stackOverflowX: stackStyle.overflowX,
                stackOverflowY: stackStyle.overflowY,
                stackPaddingTop: Number.parseFloat(stackStyle.paddingTop),
                stackPaddingBottom: Number.parseFloat(stackStyle.paddingBottom),
                stackPaddingLeft: Number.parseFloat(stackStyle.paddingLeft),
                stackPaddingRight: Number.parseFloat(stackStyle.paddingRight),
                stackLeft: stackRect.left,
                stackRight: stackRect.right,
                triggerLeftClearance: triggerRect.left - stackRect.left,
                triggerRightClearance: stackRect.right - triggerRect.right,
                triggerTopClearance: triggerRect.top - stackRect.top,
                triggerShadow: getComputedStyle(brokerTrigger).boxShadow,
                brokerOverflow: getComputedStyle(broker).overflow,
                fieldGroupOverflow: getComputedStyle(fieldGroup).overflow,
                cardOverflows: cards.map((card) => getComputedStyle(card).overflow),
                cardLeftClearances: cardRects.map((rect) => rect.left - stackRect.left),
                cardRightClearances: cardRects.map((rect) => stackRect.right - rect.right),
                pageOverflow: document.documentElement.scrollWidth
                    - document.documentElement.clientWidth,
                viewportWidth: window.innerWidth,
                layoutRole: stack.dataset.layoutRole,
                scrollable: stack.scrollHeight > stack.clientHeight + 1,
            };
        });

        expect(geometry, JSON.stringify({viewport, geometry})).not.toBeNull();
        expect(geometry.formOverflow).toBe('visible');
        expect(geometry.stackOverflowX).toBe('hidden');
        expect(geometry.stackOverflowY).toBe('auto');
        expect(geometry.stackPaddingTop).toBeGreaterThanOrEqual(24);
        expect(geometry.stackPaddingBottom).toBeGreaterThanOrEqual(48);
        expect(geometry.stackPaddingLeft).toBeGreaterThanOrEqual(32);
        expect(geometry.stackPaddingRight).toBeGreaterThanOrEqual(36);
        expect(geometry.triggerLeftClearance).toBeGreaterThanOrEqual(31);
        expect(geometry.triggerRightClearance).toBeGreaterThanOrEqual(35);
        expect(geometry.triggerTopClearance).toBeGreaterThanOrEqual(23);
        expect(geometry.triggerShadow).not.toBe('none');
        expect(geometry.brokerOverflow).toBe('visible');
        expect(geometry.fieldGroupOverflow).toBe('visible');
        expect(geometry.cardOverflows).toEqual(['visible', 'visible']);
        expect(Math.min(...geometry.cardLeftClearances)).toBeGreaterThanOrEqual(31);
        expect(Math.min(...geometry.cardRightClearances)).toBeGreaterThanOrEqual(35);
        expect(geometry.stackLeft).toBeGreaterThanOrEqual(-1);
        expect(geometry.stackRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
        expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
        expect(geometry.layoutRole).toBe('content-scrollport');
        if (viewport.height === 420) {
            expect(geometry.scrollable).toBe(true);
        }
    }

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
});

test('uses Process List across brokers and remembers the Investment import choice', async ({page}) => {
    await mockInvestmentReadApis(page, {transactions: [], brokerSummaries: {}});
    await page.setViewportSize({width: 830, height: 1291});
    await page.goto('/trade/investment');
    await page.evaluate(() => localStorage.removeItem('worthward:investment-import-broker'));
    await page.reload();
    await page.locator('#toggle_form_button').click();
    await expect(page.locator('#investment_import_broker')).toHaveValue('hsbc');

    const hsbcSteps = page.locator(
        '#investment_import_hsbc_fields [data-hsbc-import-mode-panel="paste"] > ol.process-list > li.process-list-step',
    );
    await expect(hsbcSteps).toHaveCount(3);
    await expect(hsbcSteps.locator(':scope > .process-list-marker')).toHaveText(['1', '2', '3']);
    await expect(hsbcSteps.nth(0)).toHaveAttribute('data-process-continues', '');
    await expect(hsbcSteps.nth(1)).toHaveAttribute('data-process-continues', '');
    await expect(hsbcSteps.nth(2)).not.toHaveAttribute('data-process-continues');
    await expect(page.locator('#investment_import_hsbc_fields [data-hsbc-import-mode-panel="paste"] > ol')).toHaveAttribute('role', 'list');
    await expect(page.locator('#investment_import_hsbc_fields .investment-import-paste-button')).toHaveCount(3);
    for (const [selector, count] of [
        ['#investment_import_ibkr_fields [data-ibkr-import-mode-panel="csv"]', 2],
        ['#investment_import_ibkr_fields [data-ibkr-import-mode-panel="gainskeeper"]', 1],
        ['#investment_import_ibkr_fields [data-ibkr-import-mode-panel="web_paste"]', 3],
        ['#investment_import_longbridge_hk_fields', 2],
        ['#investment_import_longbridge_sg_fields', 2],
        ['#investment_import_futuhk_fields', 1],
        ['#investment_import_boc_hk_fields', 1],
        ['#investment_import_tigertrade_fields', 1],
        ['#investment_import_usmart_hk_fields', 1],
        ['#investment_import_zircon_hk_fields', 2],
    ]) {
        await expect(page.locator(`${selector} > ol.process-list > li.process-list-step`)).toHaveCount(count);
    }
    const modalGeometry = await page.locator('#investment_form').evaluate((modal) => {
        const close = modal.querySelector('#investment_import_close_button');
        const broker = modal.querySelector('[data-shared-select-kind="investment-import-broker"]');
        const modalRect = modal.getBoundingClientRect();
        const closeRect = close.getBoundingClientRect();
        const brokerRect = broker.getBoundingClientRect();
        return {
            directChild: close.parentElement === modal,
            insetTop: closeRect.top - modalRect.top,
            insetLeft: closeRect.left - modalRect.left,
            cssTop: getComputedStyle(close).top,
            cssLeft: getComputedStyle(close).left,
            buttonSize: closeRect.width,
            noBrokerOverlap: closeRect.bottom <= brokerRect.top || closeRect.right <= brokerRect.left,
        };
    });
    expect(modalGeometry.directChild).toBe(true);
    expect(modalGeometry.cssTop).toBe('12px');
    expect(modalGeometry.cssLeft).toBe('12px');
    expect(Math.abs(modalGeometry.insetTop - modalGeometry.insetLeft)).toBeLessThanOrEqual(1);
    expect(modalGeometry.buttonSize).toBe(24);
    expect(modalGeometry.noBrokerOverlap).toBe(true);

    await page.locator('#investment_import_broker').evaluate((select) => {
        select.value = 'schwab';
        select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await expect(page.locator('#investment_import_schwab_fields > ol.process-list > li')).toHaveCount(2);
    expect(await page.evaluate(() => localStorage.getItem('worthward:investment-import-broker'))).toBe('schwab');
    await page.locator('#investment_import_close_button').click({force: true});
    await expect(page.locator('#investment_import_close_button')).toBeHidden();
    await page.locator('#toggle_form_button').click();
    await expect(page.locator('#investment_import_broker')).toHaveValue('schwab');
    await page.reload();
    await page.locator('#toggle_form_button').click();
    await expect(page.locator('#investment_import_broker')).toHaveValue('schwab');

    await page.setViewportSize({width: 390, height: 844});
    await expect.poll(() => page.evaluate(() => (
        document.documentElement.scrollWidth - document.documentElement.clientWidth
    ))).toBeLessThanOrEqual(1);
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
        window.localStorage.setItem('worthward:theme-mode', 'light');
    });
    await page.setViewportSize({width: 825, height: 773});
    await page.goto('/trade/investment');
    await page.evaluate(() => {
        document.documentElement.dataset.themeMode = 'light';
        document.documentElement.setAttribute('data-theme-override', 'light');
        window.dispatchEvent(new CustomEvent('worthward:theme-mode-change', {
            detail: {mode: 'light'},
        }));
    });
    await page.locator('#toggle_form_button').click();
    const importControlState = await page.locator('.investment-import-control-rail').evaluate((rail) => {
        const openButton = rail.querySelector('#toggle_form_button');
        const modal = document.querySelector('#investment_form');
        const closeButton = modal.querySelector('#investment_import_close_button');
        const closeRect = closeButton.getBoundingClientRect();
        const modalRect = modal.getBoundingClientRect();
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
            modalTop: modalRect.top,
            modalLeft: modalRect.left,
            closeParentIsModal: closeButton.parentElement === modal,
            closeSize: closeRect.width,
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
    expect(importControlState.closeParentIsModal).toBe(true);
    expect(importControlState.closeSize).toBe(24);
    expect(Math.abs(importControlState.closeTop - importControlState.modalTop - 12)).toBeLessThanOrEqual(1);
    expect(Math.abs(importControlState.closeCenterX - importControlState.modalLeft - 24)).toBeLessThanOrEqual(1);
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
    expect(importActionPackageMaterial.backdropFilter).toContain('blur');
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
        const closeButton = modal.querySelector('#investment_import_close_button');
        const quickActions = document.querySelector('#global_quick_actions');
        const buttonSize = Number.parseFloat(
            getComputedStyle(document.body).getPropertyValue('--settings-round-icon-button-size'),
        ) || 36;
        const expectedModalTop = quickActions.getBoundingClientRect().top + buttonSize + 10;
        container.scrollTop = container.scrollHeight;
        stack.scrollTop = stack.scrollHeight;
        const containerRect = container.getBoundingClientRect();
        const modalRect = modal.getBoundingClientRect();
        const actionRect = actionPackage.getBoundingClientRect();
        const containerStyle = getComputedStyle(container);
        const modalStyle = getComputedStyle(modal);
        const stackRect = stack.getBoundingClientRect();
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
            closeTop: closeButton?.getBoundingClientRect().top,
            closeBottom: closeButton?.getBoundingClientRect().bottom,
            modalTop: modalRect.top,
            alignedModalHeight: window.innerHeight - (expectedModalTop * 2),
            expectedModalTop,
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
    expect(Math.abs(importScrollGeometry.closeTop - importScrollGeometry.modalTop - 12)).toBeLessThanOrEqual(2);
    expect(Math.abs(importScrollGeometry.modalTop - importScrollGeometry.expectedModalTop)).toBeLessThanOrEqual(2);

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
    await expect(page.locator('#ibkr_holdings_text')).toBeEditable();
    await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
    await expect(page.locator('#ibkr_trade_notifications_date')).toHaveAttribute('type', 'hidden');
    await expect(page.getByRole('textbox', {name: 'Type page date'})).toBeVisible();
    await expect(page.locator('[data-ibkr-import-mode-panel="web_paste"] .process-list-marker')).toHaveText(['1', '2', '3']);
    await expect(page.locator('[data-ibkr-calibration-table], [data-ibkr-calibration-row], [data-ibkr-calibration-cash], [data-ibkr-calibration-quantity]')).toHaveCount(0);
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
    await page.locator('#ibkr_holdings_text').evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                readText: async () => `Search\nAccount\nU00000001\nUSD\n1,234.56\nSettled Cash\n456.78\nYour Holdings\nInstrument Position Last Change %\nALFA\nALFA EXAMPLE FUND\n27 15.00 +0.10%\nBETA\nBETA EXAMPLE COMPANY\n3.9179 96.55 0.00%\nCash Holdings\nUSD (base currency) 456.78\nTotal Cash (in USD) 456.78\nData powered by`,
            },
        });
    });
    await page.locator('#ibkr_holdings_paste_button').click();
    await expect(page.locator('#ibkr_holdings_paste_button')).toHaveClass(/is-pasted/);
    await expect(page.locator('#ibkr_holdings_display')).toHaveValue(/IBKR Your Holdings · 2 positions .* Ready/);
    await expect(page.locator('#ibkr_holdings_text_status')).toHaveClass(/is-visible/);
    await expect(page.locator('#investment_import_submit_button')).toBeEnabled();

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
    await expect(page.locator('#investment_import_zircon_hk_fields .process-list-marker')).toHaveText(['1', '2']);
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
    await expect(page.locator('#gainskeeper_files')).toHaveCSS('line-height', '28px');
});

test('validates the optional IBKR Your Holdings paste without manual calibration fields', async ({page}) => {
    await mockInvestmentReadApis(page);
    await page.setViewportSize({width: 825, height: 773});
    await page.goto('/trade/investment');
    await page.locator('#toggle_form_button').click();

    const brokerTrigger = page.locator('[data-shared-select-kind="investment-import-broker"] [data-shared-select-trigger]');
    await brokerTrigger.click();
    await page.locator('#investment_import_broker_dropdown [role="option"][data-value="ibkr"]').click();
    await page.locator('label[for="ibkr_import_mode_web_paste"]').click();

    await expect(page.locator('#ibkr_trade_notifications_display')).toHaveCSS('height', '30px');
    await expect(page.locator('#ibkr_holdings_display')).toHaveCSS('height', '30px');
    await expect(page.locator(
        '#investment_import_ibkr_fields [data-ibkr-import-mode-panel="web_paste"] .investment-import-date-control-row .date-picker-trigger-value'
    )).toHaveCSS('height', '30px');
    await expect(page.locator('[data-ibkr-calibration-row], #ibkr_trade_notifications_cash, #ibkr_trade_notifications_positions')).toHaveCount(0);

    await page.locator('#ibkr_trade_notifications_text').evaluate((input) => {
        input.value = 'Orders & Trades\nTrade Notifications\nALFA\nBot 1 @ 10.00 on ARCA\nU00000001 Bought 1\nFilled\n1/2/2025, 8:00 PM\n10.00\n10\nFees: 0.10';
        input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await expect(page.locator('#investment_import_submit_button')).toBeEnabled();

    await page.locator('#ibkr_holdings_text').evaluate((input) => {
        input.value = 'Portfolio\nCash 123.45';
        input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await expect(page.locator('#ibkr_holdings_display')).toHaveValue(/Check format/);
    await expect(page.locator('#investment_import_submit_button')).toBeDisabled();

    await page.locator('#ibkr_holdings_text').evaluate((input) => {
        input.value = 'Account\nU00000001\nYour Holdings\nInstrument Position Last\nALFA\nALFA EXAMPLE FUND\n1 10.00 0.00%\nCash Holdings\nUSD (base currency) 123.45';
        input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await expect(page.locator('#ibkr_holdings_display')).toHaveValue(/1 position .* Ready/);
    await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
});

test('omits pre-existing Unbound rows from a later IBKR import banner', async ({page}) => {
    const transactions = [
        {
            ledger_no: 8_001,
            broker: 'ibkr',
            account: 'U00000001',
            date: '2026-08-20',
            type: 'withdrawal',
            currency: 'USD',
            amount: -1_000,
            description: 'Existing transfer outflow',
        },
        {
            ledger_no: 8_002,
            broker: 'hsbc',
            account: '000-000000-000',
            date: '2026-08-20',
            type: 'deposit',
            currency: 'USD',
            amount: 1_000,
            description: 'Existing transfer deposit',
        },
    ];
    await mockInvestmentReadApis(page, {
        brokers: ['ibkr', 'hsbc'],
        transactions: () => transactions,
    });
    await page.route('**/api/investment/transactions*', async (route) => {
        if (route.request().method() === 'GET') {
            await route.fallback();
            return;
        }
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                message: 'Imported 1 IBKR web transaction.',
                freshness_refresh_failures: [],
                summary: {
                    incremental_import: {
                        imported_record_count: 1,
                        added_record_count: 0,
                        duplicate_record_count: 1,
                    },
                },
            }),
        });
    });

    await page.goto('/trade/investment');
    await expect(page.locator('[data-investment-description-binding-alert]')).toHaveCount(1);
    await page.locator('#toggle_form_button').click();
    await page.locator('#investment_import_broker').evaluate((select) => {
        select.value = 'ibkr';
        select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await page.locator('label[for="ibkr_import_mode_web_paste"]').click();
    await page.locator('#ibkr_trade_notifications_text').evaluate((input) => {
        input.value = 'Orders & Trades\nTrade Notifications\nALFA\nBot 1 @ 10.00 on ARCA\nU00000001 Bought 1\nFilled\n8/20/2026, 8:00 PM\n10.00\n10\nFees: 0.10';
        input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
    await page.locator('#investment_import_submit_button').click();

    await expect(page.locator('#investment_import_feedback')).toBeVisible();
    await expect(page.locator('#investment_import_feedback_message')).toContainText('IBKR import complete');
    await expect(page.locator('#investment_import_feedback_message')).not.toContainText('Transfer review');
    await expect(page.locator('[data-investment-description-binding-alert]')).toHaveCount(1);
});

test('validates HSBC cash-only paste and keeps validation errors above the import modal', async ({page}) => {
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
    const invalidFeedbackBanner = page.locator('#investment_import_feedback');
    await expect(page.locator('#transaction_form_container')).toBeVisible();
    await expect(invalidFeedbackBanner).toBeVisible();
    await invalidFeedbackBanner.evaluate(async (banner) => {
        await Promise.all(banner.getAnimations().map((animation) => animation.finished));
    });
    const invalidFeedbackPaintState = await invalidFeedbackBanner.evaluate((banner) => {
        const rect = banner.getBoundingClientRect();
        const modal = document.querySelector('#transaction_form_container');
        const topmostNode = document.elementFromPoint(
            rect.left + (rect.width / 2),
            rect.top + (rect.height / 2),
        );
        return {
            parentIsBody: banner.parentElement === document.body,
            bannerOwnsTopmostNode: banner === topmostNode || banner.contains(topmostNode),
            bannerZIndex: Number.parseInt(getComputedStyle(banner).zIndex, 10),
            modalZIndex: Number.parseInt(getComputedStyle(modal).zIndex, 10),
            withinViewport: (
                rect.left >= 0
                && rect.top >= 0
                && rect.right <= window.innerWidth
                && rect.bottom <= window.innerHeight
            ),
        };
    });
    expect(invalidFeedbackPaintState.parentIsBody).toBe(true);
    expect(invalidFeedbackPaintState.bannerOwnsTopmostNode).toBe(true);
    expect(invalidFeedbackPaintState.withinViewport).toBe(true);
    expect(invalidFeedbackPaintState.bannerZIndex).toBeGreaterThan(
        invalidFeedbackPaintState.modalZIndex,
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

test('keeps unavailable daily P&L badges hidden after market-session synchronization', async ({page}) => {
    await page.addInitScript(() => {
        const RealDate = Date;
        const fixedTimestamp = new RealDate('2026-09-08T16:00:00Z').valueOf();
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
                account: 'IBKR-TEST',
                date: '2026-09-07',
                type: 'buy',
                ticker: 'TQQQ',
                currency: 'USD',
                quantity: 1,
                price: 100,
                amount: -100,
            },
        ],
        priceHistoryByTicker: {
            TQQQ: [
                {date: '2026-09-08', close: 110},
            ],
        },
        fxRateHistoryByCurrency: {},
    });

    let releaseMarketSession;
    const marketSessionReleased = new Promise((resolve) => {
        releaseMarketSession = resolve;
    });
    await page.route('**/api/market-session/us-equity?*', async (route) => {
        await marketSessionReleased;
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                market: 'us_equity',
                session: 'regular',
                is_trading_day: true,
                is_realtime_allowed: true,
                session_date: '2026-09-08',
                trading_days: [],
            }),
        });
    });

    await page.goto('/trade/investment?view=holdings');
    const holding = page.locator(
        '#investment_holdings_panel:not([hidden]) .investment-holdings-table-scroll '
        + 'tr[data-investment-holdings-ticker="TQQQ"]',
    );
    const dailyPrice = holding.locator('[data-investment-live-field="daily_last_price"]');
    const dailyUnrealized = holding.locator(
        '[data-investment-live-field="daily_unrealized_pnl"]',
    );
    const summaryUnrealized = page.locator(
        '#investment_holdings_panel:not([hidden]) '
        + '[data-investment-live-field="summary_daily_unrealized_pnl"]',
    );
    await expect(dailyPrice).toHaveAttribute('data-investment-live-number', '');
    await expect(dailyPrice).toHaveAttribute('data-investment-live-display', '-');
    await expect(dailyPrice.locator('..')).toBeHidden();
    await expect(dailyUnrealized).toHaveAttribute('data-investment-live-number', '');
    await expect(dailyUnrealized).toHaveAttribute('data-investment-live-display', '-');
    await expect(dailyUnrealized.locator('..')).toBeHidden();
    await expect(summaryUnrealized).toHaveAttribute('data-investment-live-number', '');
    await expect(summaryUnrealized.locator('..')).toBeHidden();

    const sessionResponse = page.waitForResponse((response) => (
        response.url().includes('/api/market-session/us-equity')
    ));
    releaseMarketSession();
    await sessionResponse;
    await expect(dailyPrice.locator('..')).toBeHidden();
    await expect(dailyUnrealized.locator('..')).toBeHidden();
    await expect(summaryUnrealized.locator('..')).toBeHidden();
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
