/* Code version: v1.3.0 */
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
            description: 'TO USMART T548125QU155(48FEB12)',
            source: {file_kind: 'hsbc_statement_cash', source_filename: 'eStatementFile_649434.pdf', row_number: 31},
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
            source: {file_kind: 'hsbc_statement_cash', source_filename: 'eStatementFile_649434.pdf', row_number: 33},
        },
    ];
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'usmart_hk'],
        transactions: [
            {
                ledger_no: 10_100,
                broker: 'usmart_hk',
                account: '07723146',
                date: '2023-02-20',
                type: 'deposit',
                currency: 'HKD',
                amount: 100,
                description: 'eDDA Cash Deposit',
                source: {file_kind: 'usmart_hk_statement_pdf', source_filename: '20230301-07723146.pdf', row_number: 29},
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

    // An unrelated IBKR buy is not transfer evidence; no source is offered
    // until the matching source transfer-out is imported.
    await expect(page.locator(
        '#investment_history select[data-investment-security-transfer-receipt-key]',
    )).toHaveCount(0);
    await expect(
        page.locator('#investment_history tr[data-investment-history-ticker="QQQI"]'),
    ).toContainText('Awaiting the source broker transfer-out record.');
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


test('offers only a matching imported source transfer-out on an unbound Schwab receipt', async ({page}) => {
    const receiptKey = 'v2:["schwab","Individual ...001","2026-09-17","transfer_in","QQQI","10","USD"]';
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'ibkr', 'schwab'],
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
                broker: 'hsbc',
                account: '000-000000-001',
                date: '2026-09-10',
                type: 'buy',
                currency: 'USD',
                ticker: 'QQQI',
                quantity: 20,
                price: 54,
                amount: -1080,
                description: 'QQQI buy',
                source: {row_number: 1},
            },
            {
                broker: 'ibkr',
                account: 'U00000001',
                date: '2026-09-16',
                type: 'transfer_out',
                currency: 'USD',
                ticker: 'QQQI',
                quantity: 10,
                amount: 0,
                description: 'FOP transfer out: QQQI',
                source: {row_number: 2},
            },
            {
                broker: 'ibkr',
                account: 'U00000001',
                date: '2026-09-17',
                type: 'transfer_out',
                currency: 'USD',
                ticker: 'QQQI',
                quantity: 10,
                amount: 0,
                description: 'FOP transfer out: QQQI',
                source: {row_number: 3},
            },
            {
                broker: 'schwab',
                account: 'Individual ...001',
                date: '2026-09-17',
                type: 'transfer_in',
                currency: 'USD',
                ticker: 'QQQI',
                quantity: 10,
                amount: 0,
                description: 'NEOS NASDAQ-100(R) HIGH INCOME ETF',
                source: {row_number: 4},
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

    const receiptSelect = page.locator(
        '#investment_history select.investment-security-transfer-receipt-bind-select',
    );
    await expect(receiptSelect).toHaveCount(1);
    await expect(receiptSelect).toHaveAttribute(
        'data-investment-security-transfer-receipt-key',
        receiptKey,
    );
    const offeredOptions = await receiptSelect.locator('option').evaluateAll((options) => (
        options.filter((option) => option.value).map((option) => ({
            value: option.value,
            label: option.textContent.trim(),
        }))
    ));
    expect(offeredOptions).toHaveLength(1);
    expect(offeredOptions[0].value).toContain('"ibkr"');
    expect(offeredOptions[0].value).toContain('"2026-09-17","transfer_out","QQQI","10"');
    expect(offeredOptions[0].label).not.toContain('HSBC');
    await receiptSelect.selectOption(offeredOptions[0].value);

    await expect.poll(() => persistedBindingRequest).toEqual({
        source_key: offeredOptions[0].value,
        target_key: receiptKey,
    });
});

test('lets a bank deposit bind a currency-less IBKR Transactions CSV withdrawal', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'ibkr'],
        transactions: [
            {
                broker: 'ibkr',
                account: 'U00000001',
                date: '2026-09-17',
                datetime: '2026-09-17 20:00:00',
                type: 'withdrawal',
                currency: null,
                amount: -158.95,
                description: 'Disbursement Initiated by Account Holder',
                source: {file_kind: 'transactions', row_number: 11, transaction_type_raw: 'Withdrawal'},
            },
            {
                broker: 'hsbc',
                account: '000-000000-001',
                date: '2026-09-17',
                datetime: '2026-09-17 20:00:00',
                type: 'deposit',
                currency: 'USD',
                amount: 158.95,
                description: 'HK000000TESTREF',
                source: {file_kind: 'hsbc_usd_account_text', row_number: 48},
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

    const bindingSelect = page.locator('#investment_history select[data-investment-transfer-source-key]');
    await expect(bindingSelect).toHaveCount(1);
    await expect(bindingSelect).toHaveAttribute(
        'data-investment-transfer-source-key',
        /"hsbc".*"deposit"/,
    );
    const targetKey = await bindingSelect.locator('option').evaluateAll((options) => (
        options.map((option) => option.value).find((value) => value.includes('"ibkr"'))
    ));
    expect(targetKey).toContain('"withdrawal"');
    await bindingSelect.selectOption(targetKey);
    await expect.poll(() => persistedBindingRequest?.target_key).toBe(targetKey);
});

test('replays a later-imported IBKR closing withdrawal before its authoritative HSBC receipt', async ({page}) => {
    const sourceKey = `v2:${JSON.stringify(['hsbc', '000-000000-001', '2026-09-17', 'deposit', 'USD', '158.95'])}`;
    const targetKey = `v2:${JSON.stringify(['ibkr', 'ibkr:u-suffix:00001', '2026-09-17', 'withdrawal', 'USD_OR_MISSING', '-158.95'])}`;
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'ibkr'],
        startingCash: 158.95371954792775,
        transactions: [
            {
                broker: 'hsbc',
                account: '000-000000-001',
                date: '2026-09-17',
                datetime: '2026-09-17 20:00:00',
                type: 'deposit',
                currency: 'USD',
                amount: 158.95,
                description: 'HSBC matching receipt',
                source: {
                    file_kind: 'hsbc_usd_account_text',
                    cash_balance_authoritative: true,
                    account_type: 'USD Savings',
                    balance_after_raw: '158.95',
                    row_number: 48,
                },
            },
            {
                broker: 'ibkr',
                account: 'U00000001',
                date: '2026-09-17',
                datetime: '2026-09-17 20:00:00',
                type: 'transfer_out',
                ticker: 'QQQI',
                currency: 'USD',
                quantity_abs: '10',
                amount: 0,
                description: 'QQQI transfer out',
                normalized: {position_quantity: '10', net_amount: '0'},
                source: {file_kind: 'ibkr_transfers', row_number: 64, transfer_direction: 'out'},
            },
            {
                broker: 'ibkr',
                account: 'U00000001',
                date: '2026-09-17',
                datetime: '2026-09-17 20:00:00',
                type: 'withdrawal',
                currency: null,
                amount: -158.95,
                description: 'IBKR closing withdrawal',
                source: {file_kind: 'transactions', row_number: 11, transaction_type_raw: 'Withdrawal'},
            },
        ],
        manualInternalTransferBindings: {[sourceKey]: targetKey},
        brokerSummaries: {
            ibkr: {
                broker: 'ibkr',
                account: 'U00000001',
                starting_cash: '158.95371954792775',
                ending_cash: '0.00371954792775',
                ending_cash_as_of: '2026-09-17',
                ending_cash_replay_as_of: '2026-09-17',
                cash_snapshot_authoritative: true,
                position_snapshot_authoritative: true,
                position_snapshot_as_of: '2026-09-16 15:25:00',
                position_snapshot: {
                    QQQI: {
                        quantity: '10',
                        currency: 'USD',
                        cost_basis_status: 'unknown',
                    },
                },
            },
        },
        priceHistoryByTicker: {
            QQQI: [{date: '2026-09-17', close: 53.27}],
        },
    });
    await page.goto('/trade/investment?view=holdings');

    const renderedHistoryRows = page.locator('#investment_history tr[data-investment-history-row]');
    await expect(renderedHistoryRows).toHaveCount(3);
    const historyRows = await page.locator('#investment_history tr[data-investment-history-row]').evaluateAll((rows) => (
        rows.map((row) => {
            const cells = [...row.querySelectorAll('td')].map((cell) => cell.textContent.trim());
            return {
                ledgerNo: Number(cells[1]),
                type: cells[3],
                currency: cells[5],
                marketValue: cells[8],
                cash: cells[9],
                equity: cells[10],
            };
        })
    ));
    const withdrawalRow = historyRows.find((row) => row.type === 'Withdrawal');
    const receiptRow = historyRows.find((row) => row.type === 'Deposit');
    expect(withdrawalRow).toBeTruthy();
    expect(receiptRow).toBeTruthy();
    expect(withdrawalRow.ledgerNo).toBeLessThan(receiptRow.ledgerNo);
    expect(withdrawalRow.currency).toBe('USD');
    expect(withdrawalRow.marketValue).toBe('0.00');
    expect(withdrawalRow.cash).toBe('0.00');
    expect(withdrawalRow.equity).toBe('0.00');
});

test('keeps HSBC cash chronology and foreign cash across a bound transfer', async ({page}) => {
    const sourceKey = `v2:${JSON.stringify(['hsbc', 'HSBC-TEST', '2026-09-17', 'deposit', 'USD', '100'])}`;
    const targetKey = `v2:${JSON.stringify(['ibkr', 'ibkr:u-suffix:00001', '2026-09-17', 'withdrawal', 'USD_OR_MISSING', '-100'])}`;
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'ibkr'],
        startingCash: 0,
        transactions: [
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-09-16',
                datetime: '2026-09-16 20:00:00',
                type: 'deposit',
                currency: 'HKD',
                amount: 100,
                description: 'HKD opening balance',
                source: {
                    file_kind: 'hsbc_multi_currency_cash_account_text',
                    account_type: 'HKD Savings',
                    balance_after_raw: '100',
                    row_number: 1,
                    ledger_sequence: 1,
                    source_sequence_sha256: 'hkd-sequence',
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-09-17',
                datetime: '2026-09-17 20:00:00',
                type: 'deposit',
                currency: 'USD',
                amount: 100,
                description: 'HSBC matching receipt',
                source: {
                    file_kind: 'hsbc_usd_account_text',
                    cash_balance_authoritative: true,
                    account_type: 'USD Savings',
                    balance_after_raw: '1000',
                    row_number: 43,
                    ledger_sequence: 43,
                    source_sequence_sha256: 'usd-sequence',
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-09-17',
                datetime: '2026-09-17 20:00:01',
                type: 'sell',
                ticker: 'SELLA',
                currency: 'USD',
                quantity: 0,
                price: 200,
                amount: 200,
                commission_raw: '-0.01',
                normalized: {net_amount: 200, commission: -0.01},
                description: 'First settled sale',
                source: {
                    file_kind: 'hsbc_order_status_text',
                    cash_settlement_date: '2026-09-18',
                    cash_settlement_postings: [{
                        date: '2026-09-18',
                        currency: 'USD',
                        amount_raw: '200',
                        balance_after_raw: '1200',
                        row_number: 44,
                        ledger_sequence: 44,
                        source_file_kind: 'hsbc_usd_account_text',
                        source_sequence_sha256: 'usd-sequence',
                        account_number: 'HSBC-TEST',
                        account_type: 'USD Savings',
                        role: 'principal',
                    }, {
                        date: '2026-09-18',
                        currency: 'USD',
                        amount_raw: '-0.01',
                        balance_after_raw: '',
                        row_number: 45,
                        ledger_sequence: 45,
                        source_file_kind: 'hsbc_usd_account_text',
                        source_sequence_sha256: 'usd-sequence',
                        account_number: 'HSBC-TEST',
                        account_type: 'USD Savings',
                        role: 'fee',
                    }],
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-09-17',
                datetime: '2026-09-17 20:00:02',
                type: 'sell',
                ticker: 'SELLB',
                currency: 'USD',
                quantity: 0,
                price: 300,
                amount: 300,
                description: 'Second settled sale',
                source: {
                    file_kind: 'hsbc_order_status_text',
                    cash_settlement_date: '2026-09-18',
                    cash_settlement_postings: [{
                        date: '2026-09-18',
                        currency: 'USD',
                        amount_raw: '300',
                        balance_after_raw: '1499.99',
                        row_number: 46,
                        ledger_sequence: 46,
                        source_file_kind: 'hsbc_usd_account_text',
                        source_sequence_sha256: 'usd-sequence',
                        account_number: 'HSBC-TEST',
                        account_type: 'USD Savings',
                    }],
                },
            },
            {
                broker: 'ibkr',
                account: 'U00000001',
                date: '2026-09-17',
                datetime: '2026-09-17 20:00:00',
                type: 'withdrawal',
                currency: null,
                amount: -100,
                description: 'IBKR closing withdrawal',
                source: {
                    file_kind: 'transactions',
                    row_number: 11,
                    transaction_type_raw: 'Withdrawal',
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-09-19',
                datetime: '2026-09-19 20:00:00',
                type: 'withdrawal',
                currency: 'HKD',
                amount: -10,
                description: 'HKD withdrawal',
                source: {
                    file_kind: 'hsbc_multi_currency_cash_account_text',
                    account_type: 'HKD Savings',
                    balance_after_raw: '90',
                    row_number: 49,
                    ledger_sequence: 49,
                    source_sequence_sha256: 'hkd-sequence',
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-09-19',
                datetime: '2026-09-19 20:00:00',
                type: 'deposit',
                currency: 'HKD',
                amount: 20,
                description: 'HKD deposit',
                source: {
                    file_kind: 'hsbc_multi_currency_cash_account_text',
                    account_type: 'HKD Savings',
                    balance_after_raw: '110',
                    row_number: 50,
                    ledger_sequence: 50,
                    source_sequence_sha256: 'hkd-sequence',
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-09-21',
                datetime: '2026-09-21 20:00:00',
                type: 'dividend',
                ticker: 'QQQI',
                currency: 'USD',
                amount: 10,
                description: 'CORP EVT PAYMENT SEC',
                source: {
                    file_kind: 'hsbc_usd_account_text',
                    cash_balance_authoritative: true,
                    account_type: 'USD Savings',
                    balance_after_raw: '1509.99',
                    row_number: 50,
                    ledger_sequence: 50,
                    source_sequence_sha256: 'usd-sequence',
                },
            },
        ],
        manualInternalTransferBindings: {[sourceKey]: targetKey},
        brokerSummaries: {
            hsbc: {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                cash_snapshot_authoritative: true,
                ending_cash: '1509.99',
                ending_cash_as_of: '2026-09-21',
                ending_cash_replay_as_of_datetime: '2026-09-21 20:00:00',
                ending_cash_by_currency: {USD: '1509.99', HKD: '110'},
                position_snapshot: {},
            },
            ibkr: {
                broker: 'ibkr',
                account: 'U00000001',
                starting_cash: '100',
                ending_cash: '0',
                ending_cash_as_of: '2026-09-17',
                cash_snapshot_authoritative: true,
                position_snapshot: {},
            },
        },
        fxRateHistoryByCurrency: {
            HKD: {
                dates: ['2026-09-16', '2026-09-17', '2026-09-19', '2026-09-21'],
                values: {
                    '2026-09-16': 10,
                    '2026-09-17': 10,
                    '2026-09-19': 10,
                    '2026-09-21': 10,
                },
            },
        },
    });
    await page.goto('/trade/investment?view=holdings&range=max');

    const rows = page.locator('#investment_history tr[data-investment-history-row]');
    await expect(rows).toHaveCount(8);
    const history = await rows.evaluateAll((renderedRows) => renderedRows.map((row) => {
        const cells = [...row.querySelectorAll('td')].map((cell) => cell.textContent.trim());
        return {
            broker: cells[0],
            ledgerNo: Number(cells[1]),
            description: cells[4],
            cash: cells[9],
        };
    }));
    const byDescription = (description) => history.find((row) => (
        row.description.includes(description)
    ));

    const withdrawal = history.find((row) => (
        row.broker === 'IBKR' && row.description.includes('IBKR closing withdrawal')
    ));
    const receipt = history.find((row) => (
        row.broker === 'HSBC' && row.description.startsWith('HSBC matching receipt')
    ));
    expect(withdrawal.ledgerNo).toBeLessThan(
        receipt.ledgerNo,
    );
    expect(receipt.ledgerNo).toBeLessThan(
        byDescription('First settled sale').ledgerNo,
    );
    expect(byDescription('First settled sale').ledgerNo).toBeLessThan(
        byDescription('Second settled sale').ledgerNo,
    );
    expect(byDescription('HKD withdrawal').ledgerNo).toBeLessThan(
        byDescription('HKD deposit').ledgerNo,
    );
    expect(receipt.cash).toBe('1,010.00');
    expect(byDescription('First settled sale').cash).toBe('1,209.99');
    expect(byDescription('Second settled sale').cash).toBe('1,509.99');
    expect(byDescription('HKD withdrawal').cash).toBe('1,508.99');
    expect(byDescription('HKD deposit').cash).toBe('1,510.99');
    expect(byDescription('CORP EVT PAYMENT SEC').cash).toBe('1,520.99');

    await expect.poll(() => page.evaluate(() => (
        window.Chart?.getChart(document.querySelector('#investmentEquityChart'))?.data?.rawLabels?.length || 0
    ))).toBeGreaterThan(0);
    const chartEndpoints = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        return Object.fromEntries((chart?.data?.rawLabels || []).map((date, index) => [
            date,
            Number(chart.data.datasets?.[0]?.data?.[index]),
        ]));
    });
    expect(Object.fromEntries([
        '2026-09-16',
        '2026-09-17',
        '2026-09-18',
        '2026-09-19',
        '2026-09-20',
        '2026-09-21',
    ].map((date) => [date, chartEndpoints[date]]))).toEqual({
        '2026-09-16': 10,
        '2026-09-17': 1_509.99,
        '2026-09-18': 1_509.99,
        '2026-09-19': 1_510.99,
        '2026-09-20': 1_510.99,
        '2026-09-21': 1_520.99,
    });
});
