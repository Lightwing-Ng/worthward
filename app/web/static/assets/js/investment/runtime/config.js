/**
 * Investment workspace immutable configuration.
 *
 * Code version: v1.0.0
 * - Added: Extracted bounded metadata and metric definitions from the entry.
 */

export function createInvestmentRuntimeConfig(runtime) {
    const config = {};
    config.INVESTMENT_OVERVIEW_INTRADAY_DAY_COUNTS = {
        '1w': 5,
        '1m': 23,
    };
    config.INVESTMENT_VIEW_ORDER = ['chart', 'holdings', 'stock_details', 'metrics'];
    config.INVESTMENT_PAGE_MEMORY_STORAGE_KEY = 'worthward:investment:page-memory:v1';
    config.INVESTMENT_INTERNAL_TRANSFER_LINK_WINDOW_DAYS = 7;
    config.INVESTMENT_INTERNAL_TRANSFER_BANK_BROKERS = new Set(['hsbc', 'boc_hk', 'cmbwl']);
    config.INVESTMENT_INTERNAL_TRANSFER_UNDATED_POSTING_LAG_DAYS = 1;
    config.INVESTMENT_LONGBRIDGE_HK_CASH_TRANSFER_LINK_WINDOW_DAYS = 2;
    config.INVESTMENT_INTERNAL_TRANSFER_IGNORE_VALUE = '__ignore__';
    config.INVESTMENT_INTERNAL_TRANSFER_RESTORE_VALUE = '__restore__';
    config.INVESTMENT_INTERNAL_TRANSFER_MONTHS = Object.freeze({
        JAN: 0,
        FEB: 1,
        MAR: 2,
        APR: 3,
        MAY: 4,
        JUN: 5,
        JUL: 6,
        AUG: 7,
        SEP: 8,
        OCT: 9,
        NOV: 10,
        DEC: 11,
    });
    config.NO_COMMISSION_TRANSACTION_TYPES = new Set([
        'foreign_tax_withholding',
        'dividend',
        'adjustment',
        'debit_interest',
        'credit_interest',
        'payment_in_lieu',
        'dividend_reinvestment',
        'forex_trade',
        'forex_trade_component',
        'fx_translation_pnl',
        'deposit',
        'kol_reward',
        'grant',
        'withdrawal',
        'virtual_balance_reset',
        'virtual_deposit',
        'virtual_withdrawal',
        'transfer_in',
        'transfer_out',
    ]);
    config.FUNDING_METRIC_DEFINITIONS = [
        {
            key: 'direct-deposits',
            label: 'Direct deposits',
            summary: 'External deposits converted to the workspace base currency at the ledger-date FX rate. Only the source amount consumed by a matched FX conversion is excluded.',
            valueKey: 'directUsdDeposits',
            rowsKey: 'directDepositRows',
            formatValue: (metrics) => runtime.formatAmountWithCurrency(metrics?.directUsdDeposits, 'USD', { showUsdSymbol: false }),
        },
        {
            key: 'net-usd-converted',
            label: 'Net USD converted',
            summary: 'USD received from matched FX conversions. Each conversion is paired by broker, account, timestamp, and source reference so the received USD is never counted as a new deposit.',
            valueKey: 'netUsdConverted',
            rowsKey: 'netUsdConvertedRows',
            formatValue: (metrics) => runtime.formatAmountWithCurrency(metrics?.netUsdConverted, 'USD', { showUsdSymbol: false }),
        },
        {
            key: 'fx-funding-loss',
            label: 'FX funding loss',
            summary: 'Funding loss on matched FX conversions after both source and received legs are expressed in USD. Ordinary trading P&L is excluded.',
            valueKey: 'fxFundingLoss',
            rowsKey: 'fxFundingLossRows',
            formatValue: (metrics) => runtime.formatMetricLossAmountWithCurrency(metrics?.fxFundingLoss, 'USD'),
            valueClass: (metrics) => runtime.getNegativeMetricClass(metrics?.fxFundingLoss),
        },
        {
            key: 'final-investable-usd',
            label: 'Final investable USD',
            summary: 'Remaining direct deposits plus USD received from matched FX conversions. This is the USD funding base used by the investment ledger.',
            valueKey: 'finalInvestableUsd',
            rowsKey: 'finalInvestableUsdRows',
            formatValue: (metrics) => runtime.formatAmountWithCurrency(metrics?.finalInvestableUsd, 'USD', { showUsdSymbol: false }),
        },
        {
            key: 'total-commission',
            label: 'Total commission',
            summary: 'All commissions charged by imported investment activity, converted to the workspace base currency at the ledger-date FX rate.',
            valueKey: 'totalCommission',
            rowsKey: 'totalCommissionRows',
            formatValue: (metrics) => runtime.formatMetricLossAmount(metrics?.totalCommission),
            valueClass: (metrics) => runtime.getNegativeMetricClass(metrics?.totalCommission),
        },
        {
            key: 'interest-charged',
            label: 'Interest charged',
            summary: 'Debit interest charged by the broker, converted to the workspace base currency at the ledger-date FX rate. It remains separate from trading commissions.',
            valueKey: 'interestCharged',
            rowsKey: 'interestChargedRows',
            formatValue: (metrics) => runtime.formatMetricLossAmount(metrics?.interestCharged),
            valueClass: (metrics) => runtime.getNegativeMetricClass(metrics?.interestCharged),
        },
    ];
    config.BROKER_BENEFIT_METRIC_DEFINITIONS = [
        {
            key: 'coupon-rebates-cash-rewards',
            label: 'Coupon rebates / Cash rewards',
            summary: 'Imported coupon rebates and cash rewards converted to the workspace base currency using each ledger date’s FX rate. FX conversion does not add a provisional marker. The converted contribution is included in P&L once.',
            valueKey: 'couponAndCashRewardIncome',
            rowsKey: 'couponAndCashRewardRows',
            detailsKey: 'couponAndCashRewardDetails',
            renderMode: 'breakdown',
            formatValue: (metrics) => runtime.formatAmountWithCurrency(
                metrics?.couponAndCashRewardIncome,
                runtime.getInvestmentBaseCurrency(),
                { showUsdSymbol: false },
            ),
            valueClass: (metrics) => runtime.getSignedMetricClass(metrics?.couponAndCashRewardIncome),
        },
        {
            key: 'kol-rewards',
            label: 'KOL rewards',
            summary: 'Imported KOL reward income converted to the workspace base currency using the FX rate for each ledger date.',
            valueKey: 'kolRewardIncome',
            rowsKey: 'kolRewardRows',
            formatValue: (metrics) => runtime.formatAmountWithCurrency(metrics?.kolRewardIncome, runtime.getInvestmentBaseCurrency(), { showUsdSymbol: false }),
            valueClass: (metrics) => runtime.getSignedMetricClass(metrics?.kolRewardIncome),
        },
        {
            key: 'stock-grant-realized-pnl',
            label: 'Stock grant realized P&L',
            summary: 'Sale proceeds matched to zero-cost broker stock-grant lots using the same ledger order as Holdings. This is a disclosure card, not an extra addition to P&L.',
            valueKey: 'stockGrantRealizedPnl',
            rowsKey: 'stockGrantRealizedRows',
            formatValue: (metrics) => runtime.formatSignedHoldingsMoney(metrics?.stockGrantRealizedPnl),
            valueClass: (metrics) => runtime.getSignedMetricClass(metrics?.stockGrantRealizedPnl),
        },
        {
            key: 'stock-grant-unrealized-pnl',
            label: 'Stock grant unrealized P&L',
            summary: 'Current mark-to-market value of still-open zero-cost broker stock-grant lots. This value already flows through ticker Holdings P&L.',
            valueKey: 'stockGrantUnrealizedPnl',
            rowsKey: 'stockGrantUnrealizedRows',
            formatValue: (metrics) => runtime.formatSignedHoldingsMoney(metrics?.stockGrantUnrealizedPnl),
            valueClass: (metrics) => runtime.getSignedMetricClass(metrics?.stockGrantUnrealizedPnl),
        },
    ];
    config.HOLDINGS_SUMMARY_METRIC_DEFINITIONS = [
        {
            key: 'cash',
            label: 'Cash',
            summary: 'Current display cash in the workspace base currency, including the same broker-scoped pending-settlement presentation used by Holdings.',
            valueKey: 'cash',
            formatValue: (metrics) => runtime.formatInvestmentCurrentCash(
                metrics?.cash,
                metrics?.cashIsApproximate === true,
            ),
            valueClass: (metrics) => runtime.getSignedMetricClass(metrics?.cash),
            liveField: 'metrics_cash',
            liveNumberKey: 'cash',
        },
        {
            key: 'market-value',
            label: 'Market value',
            summary: 'Current base-currency market value of open positions at the latest available quote.',
            valueKey: 'marketValue',
            formatValue: (metrics) => runtime.formatHoldingsMoney(metrics?.marketValue),
            valueClass: (metrics) => runtime.getSignedMetricClass(metrics?.marketValue),
            liveField: 'metrics_market_value',
            liveNumberKey: 'marketValue',
        },
        {
            key: 'total-equity',
            label: 'Total equity',
            summary: 'Current Cash plus Market value, using the same live portfolio valuation as Holdings.',
            valueKey: 'totalEquity',
            formatValue: (metrics) => runtime.formatHoldingsMoney(metrics?.totalEquity),
            valueClass: (metrics) => runtime.getSignedMetricClass(metrics?.totalEquity),
            liveField: 'metrics_total_equity',
            liveNumberKey: 'totalEquity',
        },
        {
            key: 'cumulative-pnl',
            label: 'Cumulative P&L',
            summary: 'Holdings realized P&L plus Holdings unrealized P&L, including converted broker coupon, cash, and KOL rewards. Stock-grant P&L remains attached to its ticker Holdings result.',
            valueKey: 'cumulativePnl',
            rowsKey: 'cumulativePnlRows',
            formatValue: (metrics) => runtime.formatSignedHoldingsMoney(metrics?.cumulativePnl),
            valueClass: (metrics) => runtime.getSignedMetricClass(metrics?.cumulativePnl),
            liveField: 'metrics_cumulative_pnl',
            liveNumberKey: 'cumulativePnl',
        },
        {
            key: 'realized-pnl',
            label: 'Realized P&L',
            summary: 'Realized P&L from Holdings activity, cash rewards, and explicit cash costs. Expand for trading spread, dividends, interest, and fee attribution in USD; a broker-reported reconciliation remains visible whenever authoritative broker performance data cannot be allocated row by row.',
            valueKey: 'totalRealizedPnl',
            rowsKey: 'realizedPnlRows',
            detailsKey: 'realizedPnlDetails',
            renderMode: 'breakdown',
            formatValue: (metrics) => runtime.formatSignedHoldingsMoney(metrics?.totalRealizedPnl),
            valueClass: (metrics) => runtime.getSignedMetricClass(metrics?.totalRealizedPnl),
        },
        {
            key: 'unrealized-pnl',
            label: 'Unrealized P&L',
            summary: 'Mark-to-market P&L for positions that remain open. It is calculated from current value less the replayed cost basis. Expand for position-level ticker contributions.',
            valueKey: 'totalUnrealizedPnl',
            rowsKey: 'unrealizedPnlRows',
            detailsKey: 'unrealizedPnlDetails',
            renderMode: 'breakdown',
            formatValue: (metrics) => runtime.formatSignedHoldingsMoney(metrics?.totalUnrealizedPnl),
            valueClass: (metrics) => runtime.getSignedMetricClass(metrics?.totalUnrealizedPnl),
            liveField: 'metrics_unrealized_pnl',
            liveNumberKey: 'totalUnrealizedPnl',
        },
    ];
    config.STOCK_DETAILS_DONUT_GRAY_FILL = 'color-mix(in srgb, var(--theme-muted) 34%, transparent)';
    config.INVESTMENT_SURFACE_LAYOUT_SETTLE_MS = 520;
    config.INVESTMENT_COMMON_SPLIT_FACTORS = [
        1, 1.5, 2, 3, 4, 5, 8, 10, 16, 20, 25, 32, 40, 50, 64, 80, 100, 125, 128, 160, 200, 256,
    ];
    config.INVESTMENT_STOCK_DETAILS_RANGE_OPTIONS = [
        { value: '1w', label: '1W' },
        { value: '3m', label: '3M' },
        { value: 'ytd', label: 'YTD' },
        { value: '1y', label: '1Y' },
        { value: 'max', label: 'Max' },
        { value: 'auto', label: 'Auto' },
    ];
    config.INVESTMENT_EQUITY_RANGE_OPTIONS = [
        { value: '1w', label: '1W' },
        { value: '1m', label: '1M' },
        { value: '3m', label: '3M' },
        { value: 'ytd', label: 'YTD' },
        { value: '1y', label: '1Y' },
        { value: 'max', label: 'Max' },
    ];
    config.INVESTMENT_RANGE_SEGMENTED_CONTROL_CLASS = 'segmented-control--compact investment-view-segmented investment-stock-details-range-segmented';
    config.INVESTMENT_BROKER_META = {
        ibkr: {
            code: 'ibkr',
            label: 'IBKR',
            logoUrl: '/market-store/logos/brokers/IBKR.png',
            logoAlt: 'IBKR logo',
        },
        longbridge_hk: {
            code: 'longbridge_hk',
            label: 'Longbridge (HK)',
            logoUrl: '/market-store/logos/brokers/Longbridge.png',
            logoAlt: 'Longbridge (HK) logo',
        },
        longbridge_sg: {
            code: 'longbridge_sg',
            label: 'Longbridge (SG)',
            logoUrl: '/market-store/logos/brokers/Longbridge.png',
            logoAlt: 'Longbridge (SG) logo',
        },
        hsbc: {
            code: 'hsbc',
            label: 'HSBC',
            logoUrl: '/market-store/logos/brokers/HSBC.png',
            logoAlt: 'HSBC logo',
        },
        futuhk: {
            code: 'futuhk',
            label: 'Futu (HK)',
            logoUrl: '/market-store/logos/brokers/FutuHK.svg',
            logoAlt: 'Futu (HK) logo',
        },
        cmbwl: {
            code: 'cmbwl',
            label: 'CMB Wing Lung Bank',
            logoUrl: '/market-store/logos/brokers/CMB%20Wing%20Lung.svg',
            logoAlt: 'CMB Wing Lung Bank logo',
        },
        cmb_cn: {
            code: 'cmb_cn',
            label: 'China Merchants Bank',
            logoUrl: '/market-store/logos/brokers/CMB%20Wing%20Lung.svg',
            logoAlt: 'China Merchants Bank logo',
        },
        cmb_hk: {
            code: 'cmb_hk',
            label: 'China Merchants Bank Hong Kong Branch',
            logoUrl: '/market-store/logos/brokers/CMB%20Wing%20Lung.svg',
            logoAlt: 'China Merchants Bank Hong Kong Branch logo',
        },
        boc_cn: {
            code: 'boc_cn',
            label: 'Bank of China',
            logoUrl: '/market-store/logos/brokers/Bank%20of%20China.svg',
            logoAlt: 'Bank of China logo',
        },
        boc_hk: {
            code: 'boc_hk',
            label: 'Bank of China (Hong Kong)',
            logoUrl: '/market-store/logos/brokers/Bank%20of%20China.svg',
            logoAlt: 'Bank of China logo',
        },
        icbc_cn: {
            code: 'icbc_cn',
            label: 'Industrial and Commercial Bank of China',
            logoUrl: '/market-store/logos/brokers/ICBC.svg',
            logoAlt: 'Industrial and Commercial Bank of China logo',
        },
        icbc_hk: {
            code: 'icbc_hk',
            label: 'Industrial and Commercial Bank of China (Asia)',
            logoUrl: '/market-store/logos/brokers/ICBC.svg',
            logoAlt: 'Industrial and Commercial Bank of China (Asia) logo',
        },
        ccb_cn: {
            code: 'ccb_cn',
            label: 'China Construction Bank',
            logoUrl: '/market-store/logos/brokers/CCB.svg',
            logoAlt: 'China Construction Bank logo',
        },
        ccb_hk: {
            code: 'ccb_hk',
            label: 'China Construction Bank (Asia)',
            logoUrl: '/market-store/logos/brokers/CCB.svg',
            logoAlt: 'China Construction Bank (Asia) logo',
        },
        schwab: {
            code: 'schwab',
            label: 'Charles Schwab',
            logoUrl: '/market-store/logos/brokers/Charles%20Schwab.svg',
            logoAlt: 'Charles Schwab logo',
        },
        tigertrade: {
            code: 'tigertrade',
            label: 'Tiger Trade',
            logoUrl: '/market-store/logos/brokers/TigerTrade.png',
            logoAlt: 'Tiger Trade logo',
        },
        usmart_hk: {
            code: 'usmart_hk',
            label: 'uSMART (HK)',
            logoUrl: '/market-store/logos/brokers/uSAMRT.png',
            logoAlt: 'uSMART (HK) logo',
        },
        zircon_hk: {
            code: 'zircon_hk',
            label: 'Zircon (HK)',
            logoUrl: '/market-store/logos/brokers/Zircon%20HK.png',
            logoAlt: 'Zircon (HK) logo',
        },
        standard_xlsx: {
            code: 'standard_xlsx',
            label: 'No specified broker',
            logoUrl: '/market-store/logos/brokers/Standard%20XLSX.svg',
            logoAlt: 'Standard XLSX icon',
        },
        standard_chartered_hk: {
            code: 'standard_chartered_hk',
            label: 'Standard Chartered (HK)',
            logoUrl: '/market-store/logos/brokers/Standard%20Chartered.svg',
            logoAlt: 'Standard Chartered (HK) logo',
        },
        welab_bank: {
            code: 'welab_bank',
            label: 'WeLab Bank',
            logoUrl: '/market-store/logos/brokers/WeLab%20Bank.png',
            logoAlt: 'WeLab Bank logo',
        },
    };
    config.SUPPORTED_INVESTMENT_IMPORT_BROKERS = new Set([
        'ibkr',
        'longbridge_hk',
        'longbridge_sg',
        'hsbc',
        'futuhk',
        'cmbwl',
        'cmb_cn',
        'boc_cn',
        'boc_hk',
        'icbc_cn',
        'icbc_hk',
        'ccb_cn',
        'ccb_hk',
        'schwab',
        'tigertrade',
        'usmart_hk',
        'zircon_hk',
        'standard_xlsx',
    ]);
    config.GENERIC_XLSX_INVESTMENT_BROKERS = new Set([
        'zircon_hk',
        'standard_xlsx',
        'cmb_cn',
        'boc_cn',
        'icbc_cn',
        'icbc_hk',
        'ccb_cn',
        'ccb_hk',
    ]);
    return config;
}

