/* Code version: v1.0.0 */
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
        description: '5475364 R45475',
        source: {reference_id: '5475364 R45475'},
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
        description: 'HK531169PI465311',
    };
    const bochkDeposit = {
        ledger_no: 5_402,
        broker: 'boc_hk',
        account: '65640001',
        date: '2025-07-14',
        type: 'deposit',
        currency: 'USD',
        amount: 4.93,
        description: 'Transfer CHATS58029429BKRB5802',
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
        description: 'Transfer Transaction CBS TRANSFER(3000971530009)',
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

