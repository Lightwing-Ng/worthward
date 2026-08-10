/**
 * Investment transaction and valuation helpers.
 *
 * Code version: v1.90.0
 * - Changed: Historical equity valuations now fail closed when neither a
 *   daily close nor a money-market anchor exists; transaction prices and
 *   remembered quotes are not closing-price evidence.
 * - Fixed: Daily valuation rejects non-positive closes, deduplicates price
 *   rows deterministically, and uses ledger trade prices only as degraded
 *   evidence instead of valuing missing holdings at zero.
 * - Fixed: Historical chart cash falls back to the cumulative internal-transfer
 *   bridge only on history points; the current endpoint remains broker cash.
 * - Fixed: A broker starting boundary is valid only when an explicit cash
 *   balance is present; an absent boundary no longer becomes USD 0.
 * - Fixed: Replay identities and same-day funding scopes include account IDs
 *   from normalized and source records.
 * - Changed: HSBC SEC settlement evidence now produces non-transaction cash
 *   boundaries for equity replay instead of derived transaction rows.
 * - Fixed: Future-dated HSBC settlement cash now replays on its settlement ledger date, while execution-day holdings remain unchanged.
 * - Fixed: Cash-equivalent tickers such as SGOV now use the money-market identity formatter for dividend and other cash-flow descriptions.
 * - Fixed: Ticker-level split-factor consensus now repairs isolated noisy 1.5× inferences on pre-split fills, preventing phantom residual positions such as the historical TQQQ 12.50-share balance.
 * - Fixed: Daily equity replay now uses ledger-date order independently of execution timestamps, so booking-date corrections cannot carry a stale position into the wrong day.
 * - Added: Internal-transfer cash bridges are exposed as history-only chart fields while current account cash remains tied to broker balances.
 * - Fixed: Imported split-affected trades now rescale authoritative share counts when raw broker prices are on a pre-split basis and chart closes are split-adjusted.
 * - Fixed: Historical CNY FX payloads are also available to canonical CNH rows, including cross-currency IBKR funding review.
 * - Added: Long-range daily equity charts can explicitly include every calendar day, carrying the latest available market close across non-trading days.
 * - Added: Virtual cash reconciliation rows now distinguish virtual deposits from virtual withdrawals while retaining the shared Virtual balance reset description.
 * - Fixed: Unknown carried-basis transfers append an explicit zero-cost lot instead of erasing existing tax-lot identities.
 * - Added: Holdings and Stock details share one scoped-position aggregation helper, including the same mixed-currency fail-closed contract.
 * - Fixed: Unavailable market values no longer turn portfolio weight into a numeric zero through JavaScript null coercion.
 * - Changed: Mixed-currency ticker summaries retain converted account-level realized P&L evidence while combined P&L remains unavailable.
 * - Added: Broker-scoped authoritative position snapshots remain available in mixed-broker payloads, allowing HSBC current holdings to stay separate from incomplete order replay.
 * - Fixed: HSBC pending-settlement rows can use the authoritative broker cash boundary instead of presenting replay drift as a cash loss.
 * - Fixed: Holdings now replays transactions only inside broker/account/currency lot scopes before ticker aggregation.
 * - Changed: Holdings fail closed for same-ticker positions whose cost basis spans multiple currencies instead of adding raw currency units.
 * - Fixed: Authoritative broker performance snapshots retain realized P&L even when local open-position cost basis is unavailable because of mixed currencies.
 * - Added: Buy and sell replay now uses one configurable lot-matching policy across Holdings, Stock details, and local realized P&L, defaulting to lowest-cost lots first.
 * - Fixed: Cost basis and open-position valuation now aggregate from broker/account/currency scopes.
 * - Fixed: Zero-cost grant lots remain valid open positions after a sale.
 * - Refactored: Stock-details transaction replay now uses the shared transaction applier.
 * - Fixed: Internal cash-transfer bridge amounts are converted from their source currency into the workspace base currency before aggregate equity adjustments are applied.
 * - Fixed: Imported Futu (HK) HK Stocks Account transfers now expose an aggregate-only bridge adjustment while preserving the signed subaccount cash delta.
 * - Fixed: Authoritative HSBC broker cash now converts the preserved USD, HKD, and CNH ending balances into the workspace base currency before rebuilding aggregate equity.
 * - Changed: Matched security-transfer receipts carry reconstructed FIFO basis into Holdings and P&L even when Schwab's snapshot omits cost basis, with the method preserved for display.
 * - Fixed: Authoritative Schwab position snapshots preserve unknown or partial cost basis as unavailable P&L instead of coercing blank values to zero, and use the reported close price when a last price is absent.
 * - Changed: KOL reward descriptions use the canonical `KOL Rewards` prefix while retaining imported details.
 * - Changed: eDDA and Longbridge US dividend descriptions use the standard display casing and spacing.
 * Changed: Transaction descriptions now use a canonical middle-dot separator for spaced clause delimiters.
 * Fixed: Cash descriptions retain imported source text and only use the legacy equivalent marker when currency evidence is absent.
 * Changed: Forex direction prose uses sentence case while preserving its complete currency-pair information.
 * - Added: Virtual balance reset rows preserve a marked cash zeroing without creating portfolio P&L.
 * - Added: Backend historical USD FX payloads now convert CNY/CNH and HKD using the same date-aware path.
 * - Added: HSBC cash-ledger snapshots now preserve HKD and CNH balances alongside USD.
 * - Added: Explicit account-scope history attestations can verify otherwise partial tax-lot sources only when their broker, account, ticker, currency, date, trade counts, and quantities all match.
 * - Fixed: Tax-lot replay uses broker execution chronology instead of cash-safety ordering when statement rows share one normalized timestamp.
 * - Fixed: Realized P&L is calculated inside broker-account security scopes before ticker display aggregation, and broker-reported closed-lot P&L bypasses local fee and basis reconstruction.
 * - Added: Holdings summaries retain ledger-derived realized P&L by date so open positions can display an attributable daily realized result.
 * - Fixed: Broker performance snapshots calibrate only trade P&L and retain evidenced dividend, withholding, payment-in-lieu, and adjustment cash income.
 * - Fixed: Transaction descriptions reserve @ for prices and use × for a quantity without a price.
 * - Added: US overnight quote sessions require Longbridge provenance and use the Investment realtime clock contract.
 * - Added: Extended-hours Investment pulse eligibility now requires the per-ticker Longbridge quote source while preserving regular-session fallback behavior.
 * - Added: Realtime quote source resolution preserves one provider or reports mixed provenance.
 * - Changed: HSBC statement-bundle readiness accepts one full monthly PDF while retaining paired-statement uploads.
 * - Changed: Ledger-price valuation fallbacks remain diagnostic metadata but no longer surface a user warning banner.
 * - Fixed: Daily equity chart points now preserve pending-settlement display cash so same-day HSBC pasted imports keep cash and equity aligned.
 * - Added: Longbridge HK cash-equivalent MMF income is summarized as Holdings rows even after the funds are fully redeemed.
 * - Fixed: Longbridge HK cash-equivalent transfers now expose actual cash deltas and synthetic valuation tickers so MMF placements/redemptions do not create saw-tooth overnight equity.
 * - Fixed: uSMART (HK) symbol-less fractional-share rows keep a synthetic valuation anchor until the matching sale closes them.
 * - Fixed: Tiger Trade Funds in Transit rows preserve equity instead of appearing as external cash losses.
 * - Fixed: Daily equity valuation now reads imported normalized unit prices when a closed fund has no cached market history.
 * - Added: Broker-scoped authoritative P&L calibration so Longbridge HK and SG can coexist without overwriting each other's ticker results.
 * - Added: Authoritative broker performance snapshots can calibrate selected Holdings P&L rows without changing the transaction cash ledger.
 * - Fixed: Broker P&L-excluded correction rows retain their cash impact without inflating per-symbol realized P&L.
 * - Fixed: Longbridge HK money-market placements and redemptions display their actual transfer amount while ledger equity uses only the importer-provided interest delta.
 * - Fixed: IBKR forex trade component rows now display the acquired quote currency and a compact conversion description derived from the pair rate.
 * - Fixed: Cash equivalent ticker settings now preserve an explicitly empty configured list instead of falling back to money-market defaults.
 * - Added: KOL reward rows are classified as realized income instead of ordinary deposits for funding and P&L metrics.
 * - Fixed: Broker-imported buy/sell rows now keep authoritative share counts during holdings replay instead of rescaling quantities to match split-adjusted chart closes.
 * - Fixed: Zero-price grant rows now inherit same-day rendered split factors from sibling trades, preventing stale proxy histories from leaving phantom SPYM/SPLG shares.
 * - Fixed: Split-factor replay now ignores SPY lineage proxy prices and rejects downscaling factors so SPLG grants cannot collapse into phantom SPYM short positions after git pull.
 * - Added: Exported module version metadata so browser-side cache drift can be diagnosed without manually inspecting loaded source files.
 * - Fixed: Exported lineage profile lookup helpers so investment entry code can resolve canonical successors such as SPYM without ReferenceErrors.
 * - Fixed: Transaction descriptions now render canonical investment tickers so MSFT.US displays as MSFT and SPLG.US displays as SPYM.
 * - Fixed: Holdings and stock-details aggregation now canonicalizes market-store tickers so MSFT.US rolls into MSFT and legacy SPLG.US rolls into SPYM without mutating the imported ledger.
 * - Fixed: Broker statements without intraday timestamps now replay same-time funding rows before trades and withdrawals so cash/equity does not dip negative from row order alone.
 * - Fixed: Investment ticker lineage now prefers current successor/base market stores before stale legacy `.US` caches, including SPLG to SPYM.
 * - Changed: HSBC same-day history now sorts funding cash rows ahead of trade executions, while executions still follow ascending reference codes and can reuse hidden settlement rows only as internal cash-after calibration
 * - Added: Stock details range filtering now supports a 1Y window plus an Auto lifecycle mode that keeps all buy and sell dates visible while trimming unrelated post-exit history
 * - Added: Equity range filtering now supports a 1Y window for the main portfolio overview chart
 */

export function isCompleteHsbcStatementPdfBundle(files, isPdfFile = null) {
    const normalizedFiles = Array.from(files || []);
    const pdfPredicate = typeof isPdfFile === 'function'
        ? isPdfFile
        : (file) => {
            const filename = String(file?.name || '').trim().toLowerCase();
            const mimeType = String(file?.type || '').trim().toLowerCase();
            return filename.endsWith('.pdf') || mimeType === 'application/pdf';
        };
    return (
        normalizedFiles.length >= 1
        && normalizedFiles.every((file) => pdfPredicate(file))
    );
}

export function resolveRealtimeQuoteSource(quotes = []) {
    const sources = new Set(
        (Array.isArray(quotes) ? quotes : [])
            .map((quote) => String(quote?.source || '').trim().toLowerCase())
            .filter(Boolean),
    );
    if (sources.size > 1) return 'mixed';
    return sources.values().next().value || 'realtime';
}

export function isRealtimeQuotePulseProviderEligible(quote) {
    const market = String(quote?.market || 'US').trim().toUpperCase();
    const session = String(quote?.session || '').trim().toLowerCase();
    if (market !== 'US' || !['overnight', 'pre', 'post'].includes(session)) return true;
    return String(quote?.source || '').trim().toLowerCase() === 'longbridge';
}

export function classifyInvestmentUsRealtimeSession({weekday, hour, minute} = {}) {
    const normalizedWeekday = String(weekday || '').trim();
    const normalizedHour = Number(hour);
    const normalizedMinute = Number(minute);
    if (
        !Number.isFinite(normalizedHour)
        || !Number.isFinite(normalizedMinute)
        || normalizedHour < 0
        || normalizedHour > 23
        || normalizedMinute < 0
        || normalizedMinute > 59
    ) {
        return 'off';
    }
    const totalMinutes = (normalizedHour * 60) + normalizedMinute;
    if (totalMinutes >= 20 * 60) {
        return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].includes(normalizedWeekday) ? 'overnight' : 'off';
    }
    if (totalMinutes < 4 * 60) {
        return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(normalizedWeekday) ? 'overnight' : 'off';
    }
    if (['Sat', 'Sun'].includes(normalizedWeekday)) return 'off';
    if (totalMinutes >= (9 * 60) + 30 && totalMinutes < 16 * 60) return 'intraday';
    if (totalMinutes >= 4 * 60 && totalMinutes < (9 * 60) + 30) return 'pre';
    if (totalMinutes >= 16 * 60 && totalMinutes < 20 * 60) return 'post';
    return 'off';
}

export function filterAggregateOnlyOverlayTransactions(
    transactions,
    excludedReceiptKeys,
    getTransactionKey = (transaction) => transaction?.manual_internal_transfer_key,
) {
    const excludedKeys = new Set(
        Array.from(excludedReceiptKeys || [])
            .map((key) => String(key || '').trim())
            .filter(Boolean),
    );
    if (!Array.isArray(transactions) || excludedKeys.size === 0) {
        return Array.isArray(transactions) ? [...transactions] : [];
    }
    return transactions.filter((transaction) => !excludedKeys.has(
        String(getTransactionKey(transaction) || '').trim(),
    ));
}

function isFlatScopedPosition(value) {
    const numericValue = Number(value);
    return !Number.isFinite(numericValue) || Math.abs(numericValue) < 1e-9;
}

export function aggregateInvestmentScopedPositionStates(
    states,
    ticker,
    getTickerQuoteCurrency = () => '',
) {
    const aggregate = {
        ticker,
        shares: 0,
        totalCost: 0,
        realizedPnl: 0,
        nonPerformanceRealizedPnl: 0,
        realizedPnlByDate: {},
        lastCloseDate: null,
        lastTradeDate: null,
        buyCount: 0,
        buyQuantity: 0,
        sellCount: 0,
        sellQuantity: 0,
        brokerRealizedSellCount: 0,
        realizedPnlStatus: 'complete',
        hasPartialTaxLotHistory: false,
        costBasisStatus: 'known',
        costBasisMethod: null,
        lotMatchingMethod: null,
    };
    const currencies = new Set();
    const stateValues = states instanceof Map
        ? Array.from(states.values())
        : (Array.isArray(states) ? states : []);

    stateValues.forEach((state) => {
        if (!state || typeof state !== 'object') return;
        aggregate.shares += Number(state.shares) || 0;
        aggregate.totalCost += Number(state.totalCost) || 0;
        aggregate.realizedPnl += Number(state.realizedPnl) || 0;
        aggregate.nonPerformanceRealizedPnl += Number(state.nonPerformanceRealizedPnl) || 0;
        aggregate.buyCount += Number(state.buyCount) || 0;
        aggregate.buyQuantity += Number(state.buyQuantity) || 0;
        aggregate.sellCount += Number(state.sellCount) || 0;
        aggregate.sellQuantity += Number(state.sellQuantity) || 0;
        aggregate.brokerRealizedSellCount += Number(state.brokerRealizedSellCount) || 0;
        aggregate.hasPartialTaxLotHistory = (
            aggregate.hasPartialTaxLotHistory || state.hasPartialTaxLotHistory === true
        );
        aggregate.realizedPnlStatus = (
            aggregate.realizedPnlStatus === 'incomplete' || state.realizedPnlStatus === 'incomplete'
        ) ? 'incomplete' : aggregate.realizedPnlStatus;
        if (state.costBasisStatus === 'unknown') {
            aggregate.costBasisStatus = 'unknown';
        } else if (
            state.costBasisStatus === 'partial'
            && aggregate.costBasisStatus === 'known'
        ) {
            aggregate.costBasisStatus = 'partial';
        }
        if (state.costBasisMethod) aggregate.costBasisMethod = state.costBasisMethod;
        if (state.lotMatchingMethod) aggregate.lotMatchingMethod = state.lotMatchingMethod;
        aggregate.lastTradeDate = [aggregate.lastTradeDate, state.lastTradeDate]
            .filter(Boolean)
            .sort()
            .pop() || null;
        aggregate.lastCloseDate = [aggregate.lastCloseDate, state.lastCloseDate]
            .filter(Boolean)
            .sort()
            .pop() || null;
        Object.entries(state.realizedPnlByDate || {}).forEach(([ledgerDate, value]) => {
            aggregate.realizedPnlByDate[ledgerDate] = (
                Number(aggregate.realizedPnlByDate[ledgerDate]) || 0
            ) + (Number(value) || 0);
        });
        const currency = String(
            state.lotScope?.currency || getTickerQuoteCurrency(ticker) || '',
        ).trim().toUpperCase();
        if (!isFlatScopedPosition(state.shares) && currency) currencies.add(currency);
    });

    const positionCurrencies = Array.from(currencies).sort();
    const hasMixedPositionCurrencies = positionCurrencies.length > 1;
    const hasOpenPosition = !isFlatScopedPosition(aggregate.shares);
    const averagePrice = (
        hasMixedPositionCurrencies
        || !Number.isFinite(aggregate.shares)
        || !hasOpenPosition
    ) ? null : aggregate.totalCost / Math.abs(aggregate.shares);

    return {
        ...aggregate,
        totalCost: hasMixedPositionCurrencies ? null : aggregate.totalCost,
        averagePrice,
        currencies: positionCurrencies,
        positionCurrencies,
        hasMixedPositionCurrencies,
        hasOpenPosition,
    };
}

export function createInvestmentDataUtils({
    noCommissionTransactionTypes,
    investmentCommonSplitFactors,
    parseInvestmentDateParts,
    formatInvestmentShortDateParts,
    normalizeInvestmentTicker,
    normalizeInvestmentStockDetailsRange,
    normalizeInvestmentEquityRange,
}) {
    const INVESTMENT_BASE_CURRENCY = 'USD';
    const USMART_HK_FRACTIONAL_SYNTHETIC_TICKER = 'USMART_HK_FRACTIONAL_SHARES';
    const LONGBRIDGE_HK_CASH_EQUIVALENT_SYNTHETIC_PREFIX = 'LONGBRIDGE_HK_CASH_EQUIVALENT';
    const INVESTMENT_MARKET_CURRENCY_BY_SUFFIX = {
        US: 'USD',
        HK: 'HKD',
        SH: 'CNY',
        SZ: 'CNY',
        SG: 'SGD',
    };
    const INVESTMENT_MONEY_MARKET_STANDARD_NAMES = Object.freeze({
        '005276756': 'Franklin Templeton U.S. Dollar Short-Term Money Market Fund',
        HK0000369196: 'Taikang Kaitai Overseas Short Tenor Bond Fund A USD Acc',
        HK0000478872: 'GaoTeng WeInvest Money Market A HKD Acc',
        HK0000584737: 'GaoTeng WeValue USD Money Mkt A USD Acc',
        HK0000584752: 'GaoTeng WeValue USD Money Mkt C USD Acc',
        HK0000720752: 'Ping An Money Market P USD Acc',
        HK0001039582: 'CMS USD Money Market Fund B Acc',
    });
    const INVESTMENT_MONEY_MARKET_FUND_IDENTITY = Object.freeze({
        GAOTENG_MONEY_MARKET_HKD: 'HK0000478872',
        GAOTENG_MONEY_MARKET_USD: 'HK0000584737',
        PING_AN_MONEY_MARKET_USD: 'HK0000720752',
    });
    const INVESTMENT_MONEY_MARKET_DESCRIPTION_ALIASES = Object.freeze({
        '005276756': [
            'FRANKLIN TEMPLETON OFFSHORE FUNDS FRANKLIN U.S. DOLLAR SHORT-TERM MONEY MARKET "A" (USD) INC',
            'LU0052767562',
            'L9025R513',
        ],
        HK0000478872: [
            'GAOTENG WEINVEST MONEY MARKET FUND',
            'MMF/GTMMF/100000',
        ],
        HK0000584737: [
            'GAOTENG WEVALUE USD MONEY MARKET FUND',
            'GAOTENG WEVALUE USD MONEY MKT A USD ACC',
            'MMF/GTMMF/100001',
        ],
        HK0000720752: [
            'PING AN MONEY MARKET FUND',
            'PING AN MONEY MARKET P USD ACC',
        ],
    });

    function getNormalizedTransactionType(txn) {
        return String(txn?.type || '').replace(/\s+/g, '_').toLowerCase();
    }

    const CASH_DEPOSIT_TYPES = new Set(['deposit', 'virtual_deposit']);
    const CASH_WITHDRAWAL_TYPES = new Set(['withdrawal', 'virtual_withdrawal', 'virtual_balance_reset']);

    function isCashDepositType(normalizedType) {
        return CASH_DEPOSIT_TYPES.has(normalizedType);
    }

    function isCashWithdrawalType(normalizedType) {
        return CASH_WITHDRAWAL_TYPES.has(normalizedType);
    }

    function getTransactionQuantity(txn) {
        const quantity = txn.quantity ?? txn.quantity_abs ?? txn.normalized?.position_quantity;
        return quantity === undefined || quantity === null ? null : Number(quantity);
    }

    function isTigerFundsInTransitTransfer(txn) {
        return (
            String(txn?.broker || '').trim().toLowerCase() === 'tigertrade'
            && String(txn?.source?.statement_section || '').trim() === 'Funds in Transit'
            && ['Fund Subscription', 'Fund Subscription Returned'].includes(
                String(txn?.description || '').trim(),
            )
        );
    }

    function isUsmartHkFractionalSharesTransaction(txn) {
        if (String(txn?.broker || '').trim().toLowerCase() !== 'usmart_hk') return false;
        if (String(txn?.ticker || '').trim()) return false;
        const rawItem = String(txn?.source?.statement_item_raw || '').trim();
        if (['買碎股', '买碎股', '賣碎股', '卖碎股'].includes(rawItem)) return true;
        return /^Fractional Shares (Purchase|Sale)/i.test(String(txn?.description || '').trim());
    }

    function isSyntheticCashEquivalentTicker(ticker) {
        const normalizedTicker = String(ticker || '').trim().toUpperCase();
        return (
            normalizedTicker === USMART_HK_FRACTIONAL_SYNTHETIC_TICKER
            || normalizedTicker.startsWith(`${LONGBRIDGE_HK_CASH_EQUIVALENT_SYNTHETIC_PREFIX}.`)
        );
    }

    function isLongbridgeHkCashEquivalentTransfer(txn) {
        return (
            String(txn?.broker || '').trim().toLowerCase() === 'longbridge_hk'
            && (
                txn?.normalized?.cash_equivalent_transfer === true
                || txn?.source?.cash_equivalent_transfer === true
            )
        );
    }

    function getLongbridgeHkCashEquivalentSyntheticTicker(txn) {
        if (!isLongbridgeHkCashEquivalentTransfer(txn)) return '';
        const fundId = String(
            txn?.normalized?.cash_equivalent_fund_id
            ?? txn?.source?.cash_equivalent_fund_id
            ?? 'longbridge_money_market'
        ).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const currency = normalizeCurrencyCode(formatTransactionCurrency(txn)) || INVESTMENT_BASE_CURRENCY;
        return `${LONGBRIDGE_HK_CASH_EQUIVALENT_SYNTHETIC_PREFIX}.${fundId || 'LONG_BRIDGE_MONEY_MARKET'}.${currency}`;
    }

    function getLongbridgeHkCashEquivalentTransferAmount(txn) {
        const transferAmount = Number(
            txn?.normalized?.cash_equivalent_cash_delta
            ?? txn?.normalized?.display_amount
            ?? txn?.gross_amount_raw
            ?? txn?.source?.cash_equivalent_transfer_amount_raw
            ?? txn?.normalized?.cash_flow_amount
            ?? txn?.normalized?.net_amount
            ?? 0
        );
        return Number.isFinite(transferAmount) ? transferAmount : 0;
    }

    function getTransactionAmount(txn) {
        if (isTigerFundsInTransitTransfer(txn)) {
            return 0;
        }
        if (isLongbridgeHkCashEquivalentTransfer(txn)) {
            return getLongbridgeHkCashEquivalentTransferAmount(txn);
        }
        if (txn?.normalized?.cash_equivalent_transfer === true) {
            const equityDelta = Number(
                txn?.normalized?.cash_equivalent_equity_delta
                ?? txn?.normalized?.net_amount
                ?? 0
            );
            return Number.isFinite(equityDelta) ? equityDelta : 0;
        }
        if (txn.normalized?.net_amount !== undefined && txn.normalized?.net_amount !== null) {
            return Number(txn.normalized.net_amount);
        }
        if (txn.amount !== undefined && txn.amount !== null) {
            return Number(txn.amount);
        }
        if (txn.cash !== undefined && txn.cash !== null) {
            return Number(txn.cash);
        }
        return 0;
    }

    function getInvestmentInternalTransferAggregateBridgeAmount(
        amount,
        txn,
        fxTimeline = null,
        baseCurrency = INVESTMENT_BASE_CURRENCY,
    ) {
        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount) || Math.abs(numericAmount) < 1e-9) return 0;
        const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency) || INVESTMENT_BASE_CURRENCY;
        const currency = normalizeCurrencyCode(formatTransactionCurrency(txn)) || normalizedBaseCurrency;
        return convertAmountToBaseCurrency(
            numericAmount,
            currency,
            normalizeLedgerDate(txn?.date),
            fxTimeline,
            normalizedBaseCurrency,
        );
    }

    function getInvestmentInternalTransferAggregateBridgeDelta(
        txn,
        fxTimeline = null,
        baseCurrency = INVESTMENT_BASE_CURRENCY,
    ) {
        if (txn?.internal_transfer_external_flow_excluded !== true) return 0;
        const cashDelta = getTransactionAmount(txn);
        const bridgeAmount = getInvestmentInternalTransferAggregateBridgeAmount(
            cashDelta,
            txn,
            fxTimeline,
            baseCurrency,
        );
        return Number.isFinite(bridgeAmount) ? -bridgeAmount : 0;
    }

    function getTransactionCommission(txn) {
        const commission = txn?.normalized?.commission ?? txn?.commission ?? 0;
        const numericCommission = Number(commission);
        const manualTransferCommission = Number(txn?.manual_internal_transfer_commission_amount ?? 0);
        return (Number.isFinite(numericCommission) ? numericCommission : 0)
            + (Number.isFinite(manualTransferCommission) ? manualTransferCommission : 0);
    }

    function getTransactionCashSortAmount(txn) {
        const amount = getTransactionAmount(txn);
        const numericAmount = Number(amount);
        if (Number.isFinite(numericAmount) && Math.abs(numericAmount) > 1e-9) {
            return numericAmount;
        }
        const normalizedAmount = txn?.normalized?.cash_flow_amount
            ?? txn?.normalized?.accounting_adjustment_amount
            ?? txn?.net_amount_raw
            ?? txn?.gross_amount_raw;
        const numericNormalizedAmount = Number(normalizedAmount);
        return Number.isFinite(numericNormalizedAmount) ? numericNormalizedAmount : 0;
    }

    function getSameTimeCashSafetySortCategory(txn) {
        const normalizedType = getNormalizedTransactionType(txn);
        const cashAmount = getTransactionCashSortAmount(txn);
        if (cashAmount > 1e-9) return 0;
        if (['kol_reward', 'sell', 'dividend', 'credit_interest', 'payment_in_lieu'].includes(normalizedType)
            || isCashDepositType(normalizedType)) return 0;
        if (['buy', 'dividend_reinvestment', 'grant'].includes(normalizedType)) return 1;
        if (cashAmount < -1e-9) return 2;
        if (['foreign_tax_withholding', 'debit_interest'].includes(normalizedType)
            || isCashWithdrawalType(normalizedType)) return 2;
        return 1;
    }

    function getInvestmentStartingCash() {
        const rawValue = window.ANTIGRAVITY_INVESTMENT_DATA?.starting_cash;
        if (rawValue === undefined || rawValue === null || rawValue === '') {
            return 0;
        }
        const numericValue = Number(rawValue);
        return Number.isFinite(numericValue) ? numericValue : 0;
    }

    function getInvestmentStartingCashBalances() {
        const rawBalances = window.ANTIGRAVITY_INVESTMENT_DATA?.starting_cash_by_currency;
        if (rawBalances && typeof rawBalances === 'object' && !Array.isArray(rawBalances)) {
            const normalizedBalances = cloneCashLedgerBalances(rawBalances);
            if (Object.keys(normalizedBalances).length) return normalizedBalances;
        }
        const brokerSummaries = window.ANTIGRAVITY_INVESTMENT_DATA?.broker_summaries;
        const aggregateBrokerBalances = {};
        let hasBrokerStartingBalances = false;
        if (brokerSummaries && typeof brokerSummaries === 'object') {
            Object.keys(brokerSummaries).forEach((brokerCode) => {
                const brokerBalances = getInvestmentBrokerStartingCashBalances(brokerCode);
                Object.entries(brokerBalances).forEach(([currency, value]) => {
                    const numericValue = Number(value);
                    if (!Number.isFinite(numericValue) || Math.abs(numericValue) < 1e-9) return;
                    hasBrokerStartingBalances = true;
                    aggregateBrokerBalances[currency] = (
                        Number(aggregateBrokerBalances[currency]) || 0
                    ) + numericValue;
                });
            });
        }
        if (hasBrokerStartingBalances) return aggregateBrokerBalances;
        return createCashLedger(getInvestmentStartingCash(), getInvestmentBaseCurrency());
    }

    function getInvestmentBrokerStartingCash(brokerCode) {
        const normalizedBroker = String(brokerCode || '').trim().toLowerCase();
        if (!normalizedBroker) return 0;
        const summary = window.ANTIGRAVITY_INVESTMENT_DATA?.broker_summaries?.[normalizedBroker];
        if (!summary || typeof summary !== 'object') return 0;
        const rawValue = summary.starting_cash
            ?? summary.starting_cash_raw
            ?? summary.starting_cash_base_currency;
        const numericValue = Number(rawValue);
        return Number.isFinite(numericValue) ? numericValue : 0;
    }

    function getInvestmentBrokerStartingCashBalances(brokerCode) {
        const normalizedBroker = String(brokerCode || '').trim().toLowerCase();
        if (!normalizedBroker) return {};
        const summary = window.ANTIGRAVITY_INVESTMENT_DATA?.broker_summaries?.[normalizedBroker];
        if (!summary || typeof summary !== 'object') return {};
        const rawBalances = summary.starting_cash_by_currency;
        if (rawBalances && typeof rawBalances === 'object' && !Array.isArray(rawBalances)) {
            const normalizedBalances = cloneCashLedgerBalances(rawBalances);
            if (Object.keys(normalizedBalances).length) return normalizedBalances;
        }
        const rawValue = summary.starting_cash
            ?? summary.starting_cash_raw
            ?? summary.starting_cash_base_currency;
        if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') return {};
        const numericValue = Number(rawValue);
        if (!Number.isFinite(numericValue)) return {};
        return createCashLedger(numericValue, getInvestmentBaseCurrency());
    }

    function getInvestmentEndingCash() {
        const rawValue = window.ANTIGRAVITY_INVESTMENT_DATA?.ending_cash;
        if (rawValue === undefined || rawValue === null || rawValue === '') {
            return null;
        }
        const numericValue = Number(rawValue);
        return Number.isFinite(numericValue) ? numericValue : null;
    }

    function getInvestmentEndingCashBalances() {
        const rawBalances = window.ANTIGRAVITY_INVESTMENT_DATA?.ending_cash_by_currency;
        if (rawBalances && typeof rawBalances === 'object' && !Array.isArray(rawBalances)) {
            const normalizedBalances = cloneCashLedgerBalances(rawBalances);
            if (Object.keys(normalizedBalances).length) return normalizedBalances;
        }
        const endingCash = getInvestmentEndingCash();
        return endingCash === null
            ? null
            : createCashLedger(endingCash, getInvestmentBaseCurrency());
    }

    function getInvestmentEndingCashInBaseCurrency() {
        const rawValue = window.ANTIGRAVITY_INVESTMENT_DATA?.ending_cash_base_currency;
        if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
            const numericValue = Number(rawValue);
            if (Number.isFinite(numericValue)) return numericValue;
        }
        return getInvestmentEndingCash();
    }

    function getInvestmentEndingCashInBaseCurrencyAsOf() {
        const data = window.ANTIGRAVITY_INVESTMENT_DATA || {};
        const summary = data.summary && typeof data.summary === 'object' ? data.summary : {};
        return normalizeLedgerDate(
            data.ending_cash_base_currency_as_of
            ?? summary.ending_cash_base_currency_as_of
            ?? summary.position_snapshot_as_of,
        );
    }

    function getInvestmentBrokerEndingCash(brokerCode) {
        const normalizedBroker = String(brokerCode || '').trim().toLowerCase();
        if (!normalizedBroker) return null;
        const summaries = window.ANTIGRAVITY_INVESTMENT_DATA?.broker_summaries;
        if (!summaries || typeof summaries !== 'object') return null;
        const summary = summaries[normalizedBroker];
        if (!summary || typeof summary !== 'object') return null;
        const rawValue = summary.ending_cash ?? summary.ending_cash_raw;
        if (rawValue === undefined || rawValue === null || rawValue === '') {
            return null;
        }
        const numericValue = Number(rawValue);
        return Number.isFinite(numericValue) ? numericValue : null;
    }

    function getInvestmentBrokerEndingCashBalances(brokerCode) {
        const normalizedBroker = String(brokerCode || '').trim().toLowerCase();
        if (!normalizedBroker) return null;
        const summaries = window.ANTIGRAVITY_INVESTMENT_DATA?.broker_summaries;
        if (!summaries || typeof summaries !== 'object') return null;
        const summary = summaries[normalizedBroker];
        if (!summary || typeof summary !== 'object') return null;
        const rawBalances = summary.ending_cash_by_currency;
        if (rawBalances && typeof rawBalances === 'object' && !Array.isArray(rawBalances)) {
            const normalizedBalances = cloneCashLedgerBalances(rawBalances);
            if (Object.keys(normalizedBalances).length) return normalizedBalances;
        }
        const endingCash = getInvestmentBrokerEndingCash(normalizedBroker);
        return endingCash === null
            ? null
            : createCashLedger(endingCash, getInvestmentBaseCurrency());
    }

    function getInvestmentBrokerEndingCashInBaseCurrency(brokerCode) {
        const normalizedBroker = String(brokerCode || '').trim().toLowerCase();
        if (!normalizedBroker) return null;
        const summaries = window.ANTIGRAVITY_INVESTMENT_DATA?.broker_summaries;
        const summary = summaries?.[normalizedBroker];
        const rawValue = summary?.ending_cash_base_currency;
        if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
            const numericValue = Number(rawValue);
            if (Number.isFinite(numericValue)) return numericValue;
        }
        return getInvestmentBrokerEndingCash(normalizedBroker);
    }

    function getInvestmentBrokerEndingCashAsOf(brokerCode) {
        const normalizedBroker = String(brokerCode || '').trim().toLowerCase();
        if (!normalizedBroker) return '';
        const summaries = window.ANTIGRAVITY_INVESTMENT_DATA?.broker_summaries;
        const summary = summaries?.[normalizedBroker];
        if (!summary || typeof summary !== 'object') return '';
        const explicitDate = normalizeLedgerDate(
            summary.ending_cash_base_currency_as_of
            ?? summary.ending_cash_as_of
            ?? summary.cash_snapshot_as_of,
        );
        if (explicitDate) return explicitDate;
        const positionSnapshotDate = normalizeLedgerDate(summary.position_snapshot_as_of);
        if (positionSnapshotDate) return positionSnapshotDate;
        const statementDate = normalizeLedgerDate(summary.statement_date_max);
        if (statementDate) return statementDate;
        const transactionDate = normalizeLedgerDate(summary.transaction_date_max);
        if (transactionDate) return transactionDate;
        const postDates = summary.hsbc_cash_component_post_dates;
        if (postDates && typeof postDates === 'object') {
            return Object.values(postDates).map(normalizeLedgerDate).filter(Boolean).sort().pop() || '';
        }
        return '';
    }

    function normalizeCurrencyCode(value) {
        return String(value || '').trim().toUpperCase();
    }

    function getInvestmentBaseCurrency() {
        return INVESTMENT_BASE_CURRENCY;
    }

    function isKolRewardTransaction(txn) {
        const normalizedType = getNormalizedTransactionType(txn);
        if (normalizedType === 'kol_reward') return true;
        if (normalizedType !== 'deposit') return false;
        const rawFlow = String(txn?.source?.transaction_type_raw || '').trim().toLowerCase();
        if (rawFlow === 'kol') return true;
        return /kol\s+rewards?/i.test(String(txn?.description || '').trim());
    }

    function sumKolRewardRealizedIncomeInBaseCurrency(
        transactions,
        fxTimeline,
        baseCurrency = INVESTMENT_BASE_CURRENCY,
    ) {
        return (Array.isArray(transactions) ? transactions : []).reduce((total, txn) => {
            if (!isKolRewardTransaction(txn)) return total;
            const amount = getTransactionAmount(txn);
            const currency = formatTransactionCurrency(txn) || baseCurrency;
            const ledgerDate = normalizeLedgerDate(txn?.date);
            return total + convertAmountToBaseCurrency(
                amount,
                currency,
                ledgerDate,
                fxTimeline,
                baseCurrency,
            );
        }, 0);
    }

    function getTickerQuoteCurrency(ticker) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (!normalizedTicker) return INVESTMENT_BASE_CURRENCY;
        const canonicalTicker = getInvestmentCanonicalTicker(normalizedTicker);
        const configuredMoneyMarketCurrency = normalizeCurrencyCode(
            globalThis.window?.ANTIGRAVITY_INVESTMENT_DATA?.money_market_quote_currencies?.[canonicalTicker]
            ?? globalThis.window?.ANTIGRAVITY_INVESTMENT_DATA?.money_market_quote_currencies?.[normalizedTicker],
        );
        if (configuredMoneyMarketCurrency) return configuredMoneyMarketCurrency;
        if (normalizedTicker.startsWith(`${LONGBRIDGE_HK_CASH_EQUIVALENT_SYNTHETIC_PREFIX}.`)) {
            const currency = normalizeCurrencyCode(normalizedTicker.split('.').pop());
            return currency || INVESTMENT_BASE_CURRENCY;
        }
        if (isSyntheticCashEquivalentTicker(normalizedTicker)) return INVESTMENT_BASE_CURRENCY;
        if (isForexPairTicker(normalizedTicker)) {
            const [baseCurrency] = normalizedTicker.split('.');
            return normalizeCurrencyCode(baseCurrency) || INVESTMENT_BASE_CURRENCY;
        }
        const suffix = normalizedTicker.includes('.')
            ? normalizedTicker.split('.').pop()
            : '';
        return INVESTMENT_MARKET_CURRENCY_BY_SUFFIX[normalizeCurrencyCode(suffix)] || INVESTMENT_BASE_CURRENCY;
    }

    function createCashLedger(startingCash = 0, baseCurrency = INVESTMENT_BASE_CURRENCY) {
        const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency) || INVESTMENT_BASE_CURRENCY;
        const balances = {};
        const numericStartingCash = Number(startingCash);
        if (Number.isFinite(numericStartingCash) && Math.abs(numericStartingCash) > 1e-9) {
            balances[normalizedBaseCurrency] = numericStartingCash;
        }
        return balances;
    }

    function createCashLedgerFromBalances(
        balances,
        fallbackCash = null,
        baseCurrency = INVESTMENT_BASE_CURRENCY,
    ) {
        if (balances && typeof balances === 'object' && !Array.isArray(balances)) {
            const normalizedBalances = cloneCashLedgerBalances(balances);
            if (Object.keys(normalizedBalances).length) return normalizedBalances;
        }
        return fallbackCash === null || fallbackCash === undefined
            ? {}
            : createCashLedger(fallbackCash, baseCurrency);
    }

    function cloneCashLedgerBalances(balances) {
        return Object.entries(balances || {}).reduce((snapshot, [currency, value]) => {
            const normalizedCurrency = normalizeCurrencyCode(currency);
            const numericValue = Number(value);
            if (!normalizedCurrency || !Number.isFinite(numericValue) || Math.abs(numericValue) < 1e-9) {
                return snapshot;
            }
            snapshot[normalizedCurrency] = numericValue;
            return snapshot;
        }, {});
    }

    function addCashLedgerDelta(balances, currency, amount, baseCurrency = INVESTMENT_BASE_CURRENCY) {
        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount) || Math.abs(numericAmount) < 1e-9) return;
        const normalizedCurrency = normalizeCurrencyCode(currency) || normalizeCurrencyCode(baseCurrency) || INVESTMENT_BASE_CURRENCY;
        balances[normalizedCurrency] = (Number(balances[normalizedCurrency]) || 0) + numericAmount;
        if (Math.abs(balances[normalizedCurrency]) < 1e-9) {
            delete balances[normalizedCurrency];
        }
    }

    function isCurrencyConversionCashFlow(txn) {
        const normalizedType = getNormalizedTransactionType(txn);
        if (!['deposit', 'withdrawal'].includes(normalizedType)) return false;
        return /^Currency Conversion \((Credit|Debit)\)$/i.test(String(txn?.description || '').trim());
    }

    function isForexConversionTimelineRow(txn) {
        if (isCurrencyConversionCashFlow(txn)) return true;
        const normalizedType = getNormalizedTransactionType(txn);
        if (normalizedType !== 'forex_trade_component') return false;
        const description = String(txn?.description || '').trim();
        if (/^FX FROM /i.test(description)) return true;
        return /^Currency Conversion \((Credit|Debit)\)$/i.test(
            String(txn?.source?.transaction_type_raw || '').trim(),
        );
    }

    function getForexConversionTimelineGroupKey(txn, ledgerDate) {
        const broker = String(txn?.broker || '').trim().toLowerCase();
        const account = String(txn?.account || '').trim();
        const description = normalizeTransactionDescriptionWhitespace(txn?.description || '');
        if (description) {
            return `${broker}|${account}|${ledgerDate}|${description.toUpperCase()}`;
        }
        const flowName = String(txn?.source?.transaction_type_raw || '').trim().toUpperCase();
        const datetimeKey = String(txn?.datetime || txn?.date || '').trim();
        return `${broker}|${account}|${ledgerDate}|${datetimeKey}|${flowName}`;
    }

    function recordFxRateForDate(dateRates, currency, date, rate) {
        const normalizedCurrency = normalizeCurrencyCode(currency);
        const normalizedDate = normalizeLedgerDate(date);
        const numericRate = Number(rate);
        if (!normalizedCurrency || !normalizedDate || !Number.isFinite(numericRate) || numericRate <= 0) return;
        const currencies = ['CNY', 'CNH'].includes(normalizedCurrency)
            ? ['CNY', 'CNH']
            : [normalizedCurrency];
        currencies.forEach((currencyCode) => {
            if (!dateRates[currencyCode]) {
                dateRates[currencyCode] = {};
            }
            dateRates[currencyCode][normalizedDate] = numericRate;
        });
    }

    function getTodayLedgerDate() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function recordForexTradeFxRates(transactions, dateRates, baseCurrency = INVESTMENT_BASE_CURRENCY) {
        const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency) || INVESTMENT_BASE_CURRENCY;
        (Array.isArray(transactions) ? transactions : []).forEach((txn) => {
            const normalizedType = getNormalizedTransactionType(txn);
            if (!['forex_trade', 'forex_trade_component'].includes(normalizedType)) return;
            const forexPair = String(txn?.ticker || '').trim().toUpperCase();
            const [pairBase, pairQuote] = forexPair.split('.');
            if (pairBase !== normalizedBaseCurrency || !pairQuote) return;
            const rate = getTransactionPrice(txn);
            const ledgerDate = normalizeLedgerDate(txn?.date);
            if (!ledgerDate || !Number.isFinite(rate) || rate <= 0) return;
            recordFxRateForDate(dateRates, pairQuote, ledgerDate, rate);
        });
    }

    function buildInvestmentFxRateTimeline(transactions, baseCurrency = INVESTMENT_BASE_CURRENCY) {
        const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency) || INVESTMENT_BASE_CURRENCY;
        const groupedRows = new Map();
        (Array.isArray(transactions) ? transactions : []).forEach((txn, index) => {
            if (!isForexConversionTimelineRow(txn)) return;
            const ledgerDate = normalizeLedgerDate(txn?.date);
            if (!ledgerDate) return;
            const groupKey = getForexConversionTimelineGroupKey(txn, ledgerDate);
            if (!groupedRows.has(groupKey)) {
                groupedRows.set(groupKey, []);
            }
            groupedRows.get(groupKey).push({
                txn,
                index,
                amount: getTransactionAmount(txn),
                currency: normalizeCurrencyCode(formatTransactionCurrency(txn)),
                ledgerDate,
            });
        });

        const dateRates = {};
        const externalHistory = globalThis.window?.ANTIGRAVITY_INVESTMENT_DATA?.fx_rate_history_by_currency;
        if (externalHistory && typeof externalHistory === 'object') {
            Object.entries(externalHistory).forEach(([currency, entry]) => {
                const normalizedCurrency = normalizeCurrencyCode(currency);
                if (!normalizedCurrency || normalizedCurrency === normalizedBaseCurrency) return;
                const values = entry?.values && typeof entry.values === 'object' ? entry.values : {};
                const dates = Array.isArray(entry?.dates) ? entry.dates : Object.keys(values);
                dates.forEach((date) => {
                    recordFxRateForDate(
                        dateRates,
                        normalizedCurrency,
                        date,
                        values[date],
                    );
                });
            });
        }
        groupedRows.forEach((entries) => {
            const baseEntries = entries.filter((entry) => (
                entry.currency === normalizedBaseCurrency
                && Number.isFinite(entry.amount)
                && Math.abs(entry.amount) > 1e-9
            ));
            if (!baseEntries.length) return;

            entries.forEach((entry) => {
                if (entry.currency === normalizedBaseCurrency) return;
                if (!Number.isFinite(entry.amount) || Math.abs(entry.amount) <= 1e-9) return;

                const matchedBaseEntry = baseEntries.find((baseEntry) => (
                    Math.sign(baseEntry.amount) !== Math.sign(entry.amount)
                ));
                if (!matchedBaseEntry) return;

                const inferredRate = Math.abs(entry.amount) / Math.abs(matchedBaseEntry.amount);
                recordFxRateForDate(dateRates, entry.currency, entry.ledgerDate, inferredRate);
            });
        });
        recordForexTradeFxRates(transactions, dateRates, normalizedBaseCurrency);
        (Array.isArray(transactions) ? transactions : []).forEach((txn) => {
            const currency = normalizeCurrencyCode(formatTransactionCurrency(txn));
            const ledgerDate = normalizeLedgerDate(txn?.date);
            const statementRate = Number(txn?.source?.statement_currency_to_base_rate_raw);
            if (currency && currency !== normalizedBaseCurrency && ledgerDate && Number.isFinite(statementRate) && statementRate > 0) {
                recordFxRateForDate(dateRates, currency, ledgerDate, statementRate);
            }
        });

        const timeline = {
            baseCurrency: normalizedBaseCurrency,
            ratesByCurrency: {
                [normalizedBaseCurrency]: {
                    dates: [],
                    values: {},
                },
            },
        };

        Object.entries(dateRates).forEach(([currency, dateMap]) => {
            const dates = Object.keys(dateMap).sort();
            timeline.ratesByCurrency[currency] = {
                dates,
                values: { ...dateMap },
            };
        });
        return timeline;
    }

    function getFxRateForDate(fxTimeline, currency, targetDate) {
        const normalizedCurrency = normalizeCurrencyCode(currency);
        const baseCurrency = normalizeCurrencyCode(fxTimeline?.baseCurrency) || INVESTMENT_BASE_CURRENCY;
        if (!normalizedCurrency || normalizedCurrency === baseCurrency) return 1;
        const normalizedDate = normalizeLedgerDate(targetDate);
        const entry = fxTimeline?.ratesByCurrency?.[normalizedCurrency];
        if (!normalizedDate || !entry) return null;
        const dates = Array.isArray(entry.dates) ? entry.dates : [];
        for (let index = dates.length - 1; index >= 0; index -= 1) {
            if (dates[index] <= normalizedDate) {
                const rate = Number(entry.values?.[dates[index]]);
                return Number.isFinite(rate) && rate > 0 ? rate : null;
            }
        }
        for (let index = 0; index < dates.length; index += 1) {
            if (dates[index] >= normalizedDate) {
                const rate = Number(entry.values?.[dates[index]]);
                return Number.isFinite(rate) && rate > 0 ? rate : null;
            }
        }
        return null;
    }

    function getLatestFxRateForCurrency(fxTimeline, currency) {
        const normalizedCurrency = normalizeCurrencyCode(currency);
        const baseCurrency = normalizeCurrencyCode(fxTimeline?.baseCurrency) || INVESTMENT_BASE_CURRENCY;
        if (!normalizedCurrency || normalizedCurrency === baseCurrency) return 1;
        const entry = fxTimeline?.ratesByCurrency?.[normalizedCurrency];
        const dates = Array.isArray(entry?.dates) ? entry.dates : [];
        if (!dates.length) return null;
        const latestDate = dates[dates.length - 1];
        const rate = Number(entry?.values?.[latestDate]);
        return Number.isFinite(rate) && rate > 0 ? rate : null;
    }

    function convertAmountToBaseCurrencyAtLatestRate(amount, currency, fxTimeline, baseCurrency = INVESTMENT_BASE_CURRENCY) {
        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount) || Math.abs(numericAmount) < 1e-9) return 0;
        const normalizedCurrency = normalizeCurrencyCode(currency) || normalizeCurrencyCode(baseCurrency) || INVESTMENT_BASE_CURRENCY;
        const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency) || INVESTMENT_BASE_CURRENCY;
        if (normalizedCurrency === normalizedBaseCurrency) {
            return numericAmount;
        }
        const todayRate = getFxRateForDate(fxTimeline, normalizedCurrency, getTodayLedgerDate());
        if (Number.isFinite(todayRate) && todayRate > 0) {
            return numericAmount / todayRate;
        }
        const latestRate = getLatestFxRateForCurrency(fxTimeline, normalizedCurrency);
        if (Number.isFinite(latestRate) && latestRate > 0) {
            return numericAmount / latestRate;
        }
        return numericAmount;
    }

    function convertAmountToBaseCurrency(amount, currency, targetDate, fxTimeline, baseCurrency = INVESTMENT_BASE_CURRENCY) {
        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount) || Math.abs(numericAmount) < 1e-9) return 0;
        const normalizedCurrency = normalizeCurrencyCode(currency) || normalizeCurrencyCode(baseCurrency) || INVESTMENT_BASE_CURRENCY;
        const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency) || INVESTMENT_BASE_CURRENCY;
        if (normalizedCurrency === normalizedBaseCurrency) {
            return numericAmount;
        }
        const rate = getFxRateForDate(fxTimeline, normalizedCurrency, targetDate);
        if (Number.isFinite(rate) && rate > 0) {
            return numericAmount / rate;
        }
        return numericAmount;
    }

    function sumCashLedgerInBaseCurrency(balances, targetDate, fxTimeline, baseCurrency = INVESTMENT_BASE_CURRENCY) {
        return Object.entries(balances || {}).reduce((total, [currency, value]) => (
            total + convertAmountToBaseCurrency(value, currency, targetDate, fxTimeline, baseCurrency)
        ), 0);
    }

    function getTransactionPrice(txn) {
        if (txn.normalized?.unit_price !== undefined && txn.normalized?.unit_price !== null) {
            return Number(txn.normalized.unit_price);
        }
        if (txn.price !== undefined && txn.price !== null) {
            return Number(txn.price);
        }
        return null;
    }

    function getTransactionEconomicAmount(txn) {
        if (
            isLongbridgeHkCashEquivalentTransfer(txn)
            || txn?.normalized?.cash_equivalent_transfer === true
            || isTigerFundsInTransitTransfer(txn)
        ) {
            const transferAmount = Number(
                txn?.normalized?.display_amount
                ?? txn?.gross_amount_raw
                ?? txn?.source?.cash_equivalent_transfer_amount_raw
                ?? 0
            );
            return Number.isFinite(transferAmount) ? transferAmount : 0;
        }
        const amount = getTransactionAmount(txn);
        if (Math.abs(amount) > 1e-9) return amount;

        const normalizedType = getNormalizedTransactionType(txn);
        const quantity = getTransactionQuantity(txn);
        const price = getTransactionPrice(txn);
        if (quantity === null || price === null || Number.isNaN(quantity) || Number.isNaN(price)) {
            return amount;
        }

        if (['buy', 'sell', 'grant'].includes(normalizedType)) {
            return quantity * price;
        }

        return amount;
    }

    function formatTransactionDateDisplay(txn) {
        const hsbcTradeDateDisplay = String(txn?.source?.captured_order_date_display || '').trim();
        if (hsbcTradeDateDisplay && String(txn?.broker || '').trim().toLowerCase() === 'hsbc') {
            const match = hsbcTradeDateDisplay.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
            if (match) {
                const monthMap = {
                    Jan: '01',
                    Feb: '02',
                    Mar: '03',
                    Apr: '04',
                    May: '05',
                    Jun: '06',
                    Jul: '07',
                    Aug: '08',
                    Sep: '09',
                    Oct: '10',
                    Nov: '11',
                    Dec: '12',
                };
                const day = String(match[1]).padStart(2, '0');
                const month = monthMap[String(match[2]).slice(0, 1).toUpperCase() + String(match[2]).slice(1, 3).toLowerCase()] || '';
                if (month) {
                    return `${day}/${month}/${match[3]}`;
                }
            }
            return hsbcTradeDateDisplay.replace(/\s+U\.S\.\s+ET$/i, '').trim();
        }
        const rawDate = String(txn?.date || '').trim();
        const dateParts = parseInvestmentDateParts(rawDate);
        if (!dateParts) return rawDate;
        const baseDate = formatInvestmentShortDateParts(dateParts);
        if (!rawDate.includes(' ') || rawDate.endsWith('20:00:00')) {
            return baseDate;
        }
        const timeText = rawDate.split(' ')[1] || '';
        return timeText ? `${baseDate} ${timeText}` : baseDate;
    }

    function formatAmountWithCurrency(value, currency, { showUsdSymbol = true } = {}) {
        if (value === undefined || value === null || Number.isNaN(Number(value))) return '--';
        const numericValue = Number(value);
        const sign = numericValue < 0 ? '-' : '';
        const absDisplay = formatAmount(Math.abs(numericValue));
        const normalizedCurrency = String(currency || '').trim().toUpperCase();
        if (normalizedCurrency === 'USD') {
            return showUsdSymbol ? `${sign}$${absDisplay}` : `${sign}${absDisplay}`;
        }
        if (normalizedCurrency) {
            return `${sign}${normalizedCurrency} ${absDisplay}`;
        }
        return `${sign}${absDisplay}`;
    }

    function formatTransactionCommissionDisplay(txn, { includeCurrency = false } = {}) {
        const normalizedType = getNormalizedTransactionType(txn);
        const commission = getTransactionCommission(txn);
        const feeRowNumbers = Array.isArray(txn?.source?.cash_flow_fee_row_numbers)
            ? txn.source.cash_flow_fee_row_numbers.filter((value) => Number.isFinite(Number(value)))
            : [];
        if ((!commission || Math.abs(commission) < 1e-9) && noCommissionTransactionTypes.has(normalizedType)) {
            return '-';
        }
        if ((!commission || Math.abs(commission) < 1e-9) && ['buy', 'sell'].includes(normalizedType) && !feeRowNumbers.length) {
            return '-';
        }
        const absoluteCommission = Math.abs(commission);
        if (!includeCurrency) {
            return formatAmount(absoluteCommission);
        }
        return formatAmountWithCurrency(absoluteCommission, formatTransactionCurrency(txn));
    }

    function formatTransactionCurrency(txn) {
        const normalizedType = getNormalizedTransactionType(txn);
        if (normalizedType === 'forex_trade_component') {
            const forexPair = String(txn?.ticker || '').trim();
            const [, quoteCurrency] = forexPair.split('.');
            if (quoteCurrency) return quoteCurrency;
            const explicitCurrency = String(txn?.currency || '').trim();
            if (explicitCurrency) return explicitCurrency;
            return '';
        }

        const explicitCurrency = String(txn?.currency || '').trim();
        if (explicitCurrency) return explicitCurrency;

        const ticker = String(txn?.ticker || '').trim();
        if (ticker) return getTickerQuoteCurrency(ticker);

        return '';
    }

    function formatForexTradeComponentDescription(txn) {
        const forexPair = String(txn?.ticker || '').trim();
        const [baseCurrency, quoteCurrency] = forexPair.split('.');
        const quantity = getTransactionQuantity(txn);
        const rate = getTransactionPrice(txn);

        if (!baseCurrency || !quoteCurrency || !Number.isFinite(quantity) || !Number.isFinite(rate)) {
            return normalizeTransactionDescriptionPresentation(txn.description || '--');
        }

        const acquiredQuantity = quantity * rate;
        const quantityText = Number.isInteger(acquiredQuantity)
            ? `${acquiredQuantity}`
            : formatAmount(acquiredQuantity);
        const rateText = String(txn.price_raw ?? txn.normalized?.unit_price ?? rate);
        return `Bought ${quantityText} ${quoteCurrency} @ ${baseCurrency}.${quoteCurrency} ${rateText}`;
    }

    function normalizeTransactionDescriptionWhitespace(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function normalizeKolRewardDescription(value) {
        const source = normalizeTransactionDescriptionWhitespace(value);
        const details = source
            .replace(/\bKOL\s+Rewards?\b/gi, '')
            .replace(/^\s*(?:·|•|\||:|–|—|-)+\s*|\s*(?:·|•|\||:|–|—|-)+\s*$/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        return details ? `KOL Rewards · ${details}` : 'KOL Rewards';
    }

    function normalizeLongbridgeUsDividendDescription(value) {
        let description = String(value || '');
        description = description.replace(
            /^([A-Za-z][A-Za-z0-9]*)\.US(?=\s+Cash\s+dividend\b)/i,
            '$1',
        );
        description = description.replace(/\s+,/g, ',');
        return description.replace(/,\s*Held\s*:\s*/i, ', Held: ');
    }

    function normalizeTransactionDescriptionPresentation(value) {
        let description = normalizeTransactionDescriptionWhitespace(value);
        description = description.replace(/\s*[·•]\s*/g, ' · ');
        description = description.replace(/\s+(?:-|–|—|\|)\s+/g, ' · ');
        description = description.replace(/\bEDDA\b/gi, 'eDDA');
        description = description.replace(
            /\b([A-Za-z][A-Za-z0-9._-]{0,15})\s*\(\s*([A-Za-z]{2}[A-Za-z0-9]{8,})\s*\)/g,
            (_match, ticker, identifier) => `${String(ticker).toUpperCase()} (${String(identifier).toUpperCase()})`,
        );
        [
            [/\bCash\s+Dividend\b/gi, 'Cash dividend'],
            [/\bDividend\s+Tax\b/gi, 'Dividend tax'],
            [/\bOrdinary\s+Dividend\b/gi, 'Ordinary dividend'],
            [/\bPer\s+Share\b/gi, 'per share'],
            [/\bUS\s+Tax\b/gi, 'US tax'],
        ].forEach(([pattern, replacement]) => {
            description = description.replace(pattern, replacement);
        });
        description = normalizeLongbridgeUsDividendDescription(description);
        return description.replace(
            /\bFX\s+FROM\s+([A-Z]{3})\s+TO\s+([A-Z]{3})\b/gi,
            (_match, soldCurrency, acquiredCurrency) => (
                `FX from ${String(soldCurrency).toUpperCase()} to ${String(acquiredCurrency).toUpperCase()}`
            ),
        );
    }

    function getTransactionDescriptionText(txn, fallback = '--', { normalizeWhitespace = false } = {}) {
        const rawDescription = normalizeWhitespace
            ? normalizeTransactionDescriptionWhitespace(txn?.description)
            : String(txn?.description || '').trim();
        return rawDescription || fallback;
    }

    function hasExplicitTransactionCurrency(txn) {
        return /^[A-Z]{3}$/.test(String(txn?.currency || '').trim().toUpperCase());
    }

    function getCashTransactionDescription(txn, normalizedType) {
        const rawDescription = getTransactionDescriptionText(txn, '', { normalizeWhitespace: true });
        if (rawDescription && !/^\*\s*Equivalent$/i.test(rawDescription)) {
            return normalizeTransactionDescriptionPresentation(rawDescription);
        }

        const currency = String(formatTransactionCurrency(txn) || '').trim().toUpperCase();
        if (hasExplicitTransactionCurrency(txn) && currency) {
            const action = isCashWithdrawalType(normalizedType) ? 'Withdrawal' : 'Deposit';
            return `${action} · ${currency}`;
        }

        return isCashDepositType(normalizedType) ? '* Equivalent' : '--';
    }

    function escapeInvestmentDescriptionRegExp(value) {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function getInvestmentMoneyMarketFundIdTicker(fundId) {
        const normalizedFundId = String(fundId || '')
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        return INVESTMENT_MONEY_MARKET_FUND_IDENTITY[normalizedFundId] || '';
    }

    function getInvestmentMoneyMarketDisplayName(ticker) {
        const canonicalTicker = String(getInvestmentCanonicalTicker(ticker) || ticker || '')
            .trim()
            .toUpperCase();
        if (!canonicalTicker) return '';
        const payloadNames = globalThis.window?.ANTIGRAVITY_INVESTMENT_DATA?.known_ticker_company_names;
        const payloadName = payloadNames && typeof payloadNames === 'object' && !Array.isArray(payloadNames)
            ? String(payloadNames[canonicalTicker] || '').trim()
            : '';
        return payloadName || INVESTMENT_MONEY_MARKET_STANDARD_NAMES[canonicalTicker] || '';
    }

    function getInvestmentMoneyMarketDescriptionAliases(ticker) {
        const canonicalTicker = String(getInvestmentCanonicalTicker(ticker) || ticker || '')
            .trim()
            .toUpperCase();
        const aliases = [
            canonicalTicker,
            `${canonicalTicker}.HK`,
            `${canonicalTicker}.USD`,
            getInvestmentMoneyMarketDisplayName(canonicalTicker),
            ...(INVESTMENT_MONEY_MARKET_DESCRIPTION_ALIASES[canonicalTicker] || []),
        ];
        return Array.from(new Set(aliases.map((value) => String(value || '').trim()).filter(Boolean)))
            .sort((left, right) => right.length - left.length);
    }

    function canonicalizeInvestmentMoneyMarketTicker(candidate) {
        const fundTicker = getInvestmentMoneyMarketFundIdTicker(candidate);
        const normalizedCandidate = String(fundTicker || candidate || '').trim().toUpperCase();
        if (!normalizedCandidate) return '';
        const canonicalTicker = String(getInvestmentCanonicalTicker(normalizedCandidate) || normalizedCandidate)
            .trim()
            .toUpperCase();
        const candidates = [
            canonicalTicker,
            canonicalTicker.replace(/\.(USD|HKD)$/i, ''),
            normalizedCandidate.replace(/\.(USD|HKD)$/i, ''),
        ];
        const configuredTickers = getMoneyMarketTickerSet();
        return candidates.find((value) => configuredTickers.has(value)) || '';
    }

    function resolveInvestmentMoneyMarketTransactionIdentity(txn) {
        const candidateValues = [
            txn?.ticker,
            isLongbridgeHkCashEquivalentTransfer(txn)
                ? getLongbridgeHkCashEquivalentSyntheticTicker(txn)
                : '',
            txn?.normalized?.cash_equivalent_fund_id,
            txn?.source?.cash_equivalent_fund_id,
        ];
        for (const candidate of candidateValues) {
            const canonicalTicker = canonicalizeInvestmentMoneyMarketTicker(candidate);
            if (!canonicalTicker) continue;
            const displayName = getInvestmentMoneyMarketDisplayName(canonicalTicker);
            if (displayName) return {ticker: canonicalTicker, name: displayName};
        }

        const rawDescription = normalizeTransactionDescriptionWhitespace(txn?.description).toUpperCase();
        if (!rawDescription) return null;
        const configuredTickers = Array.from(getMoneyMarketTickerSet())
            .sort((left, right) => right.length - left.length);
        for (const ticker of configuredTickers) {
            const tickerPattern = new RegExp(
                `\\b${escapeInvestmentDescriptionRegExp(ticker)}(?:\\.(?:HK|HKD|USD|US))?\\b`,
                'i',
            );
            if (tickerPattern.test(rawDescription)) {
                const displayName = getInvestmentMoneyMarketDisplayName(ticker);
                if (displayName) return {ticker, name: displayName};
            }
            const aliases = getInvestmentMoneyMarketDescriptionAliases(ticker)
                .filter((alias) => alias !== ticker && !alias.endsWith('.HK') && !alias.endsWith('.USD'));
            if (aliases.some((alias) => rawDescription.includes(alias.toUpperCase()))) {
                const displayName = getInvestmentMoneyMarketDisplayName(ticker);
                if (displayName) return {ticker, name: displayName};
            }
        }
        return null;
    }

    function getInvestmentMoneyMarketActionLabel(txn) {
        const rawAction = String(
            txn?.normalized?.cash_equivalent_action
            ?? txn?.source?.cash_equivalent_action
            ?? '',
        ).trim().toLowerCase();
        if (['placement', 'subscription', 'buy'].includes(rawAction)) return 'Subscription';
        if (['redemption', 'withdrawal', 'sell'].includes(rawAction)) return 'Redemption';
        const normalizedType = getNormalizedTransactionType(txn);
        if (normalizedType === 'dividend_reinvestment') return 'Dividend reinvestment';
        if (normalizedType === 'dividend') return 'Dividend';
        return '';
    }

    function getInvestmentMoneyMarketQuantityLabel(txn) {
        const rawQuantity = txn?.quantity_abs
            ?? txn?.normalized?.display_quantity
            ?? txn?.quantity;
        if (rawQuantity === undefined || rawQuantity === null || rawQuantity === '') return '';
        const numericQuantity = Number(rawQuantity);
        if (Number.isFinite(numericQuantity)) {
            return Number.isInteger(numericQuantity)
                ? String(Math.trunc(numericQuantity))
                : String(rawQuantity).trim();
        }
        return String(rawQuantity).trim();
    }

    function getInvestmentMoneyMarketTransactionDetails(txn, identity) {
        const normalizedType = getNormalizedTransactionType(txn);
        if (normalizedType === 'dividend_reinvestment') {
            const quantityLabel = getInvestmentMoneyMarketQuantityLabel(txn);
            return quantityLabel
                ? `Dividend reinvestment × ${quantityLabel}`
                : 'Dividend reinvestment';
        }

        let details = normalizeTransactionDescriptionWhitespace(txn?.description);
        if (details) {
            getInvestmentMoneyMarketDescriptionAliases(identity.ticker).forEach((alias) => {
                details = details.replace(
                    new RegExp(escapeInvestmentDescriptionRegExp(alias), 'ig'),
                    ' ',
                );
            });
            details = details.replace(/MMF\/GTMMF\/\d+/ig, ' ');
            details = details.replace(/\(Withdrawal\)/ig, 'Redemption');
            details = details.replace(/\bFund\s+(Subscription|Redemption)\s*#?/ig, '$1');
            details = details.replace(/\bSubscription\s+of\s+of\b/ig, 'Subscription');
            details = details.replace(/\bRedemption\s+of\s+of\b/ig, 'Redemption');
            details = details.replace(/\(\s*\)/g, ' ');
            details = details.replace(/\s+/g, ' ').trim();
            details = details.replace(/^[#·|:/,\-]+|[#·|:/,\-]+$/g, '').trim();
        }

        const actionLabel = getInvestmentMoneyMarketActionLabel(txn);
        if (!details) return actionLabel;
        const includesAction = /\b(subscription|redemption|dividend)\b/i.test(details);
        return actionLabel && !includesAction ? `${actionLabel} · ${details}` : details;
    }

    function formatInvestmentMoneyMarketTransactionDescription(txn, identity, currentDescription) {
        if (!identity) return currentDescription;
        const normalizedType = getNormalizedTransactionType(txn);
        if (['buy', 'sell', 'grant'].includes(normalizedType)) return currentDescription;
        let details = getInvestmentMoneyMarketTransactionDetails(txn, identity);
        if (!details && currentDescription) {
            const tickerPattern = new RegExp(`^${escapeInvestmentDescriptionRegExp(identity.ticker)}\\s*`, 'i');
            details = String(currentDescription).replace(tickerPattern, '').trim();
        }
        const identityLabel = `${identity.ticker} · ${identity.name}`;
        return details ? `${identityLabel} · ${details}` : identityLabel;
    }

    function getHsbcReferenceCodeSummary(txn) {
        const rawCodes = [
            String(txn?.source?.statement_order_id || txn?.source?.order_id || '').trim(),
            String(txn?.source?.cash_settlement_reference || '').replace(/\s+/g, ' ').trim(),
        ].filter(Boolean);
        if (!rawCodes.length) return '';
        return Array.from(new Set(rawCodes)).join(', ');
    }

    function getHsbcOrderSequenceNumber(txn) {
        const rawCashSettlementRow = Number(txn?.source?.cash_settlement_source_row_number);
        if (Number.isFinite(rawCashSettlementRow) && rawCashSettlementRow > 0) {
            return rawCashSettlementRow;
        }
        const rawReference = String(txn?.source?.statement_order_id || txn?.source?.order_id || '').trim().toUpperCase();
        const match = rawReference.match(/^[PS]-(\d+)$/);
        return match ? Number(match[1]) : Number.NaN;
    }

    function getHsbcSortCategory(txn) {
        const fileKind = String(txn?.source?.file_kind || '').trim().toLowerCase();
        const normalizedType = getNormalizedTransactionType(txn);
        if (['hsbc_usd_account_text', 'hsbc_multi_currency_cash_account_text', 'hsbc_statement_cash'].includes(fileKind)) {
            if (isCashDepositType(normalizedType) || normalizedType === 'credit_interest') return 0;
            if (isCashWithdrawalType(normalizedType) || normalizedType === 'debit_interest') return 2;
            return 3;
        }
        if (fileKind === 'hsbc_order_status_text' || fileKind === 'hsbc_order_status_capture') {
            return 1;
        }
        return 9;
    }

    function formatTransactionDescription(txn) {
        let description;
        const price = txn.normalized?.unit_price ?? txn.price;
        const normalizedTypeDesc = getNormalizedTransactionType(txn);
        let qty = normalizedTypeDesc === 'adjustment'
            ? (txn.quantity_raw ?? txn.normalized?.position_quantity ?? txn.quantity_abs)
            : (txn.quantity ?? txn.quantity_abs ?? txn.normalized?.display_quantity);
        const brokerCode = String(txn?.broker || txn?.source?.broker || '').trim().toLowerCase();

        if (normalizedTypeDesc === 'forex_trade_component') {
            return formatForexTradeComponentDescription(txn);
        }

        if (txn.ticker && qty) {
            const displayTicker = getInvestmentCanonicalTicker(txn.ticker) || txn.ticker;
            const cleanQty = Number.isInteger(Number(qty)) ? String(parseInt(qty, 10)) : qty;
            if (price && ['buy', 'sell'].includes(normalizedTypeDesc)) {
                const cleanPrice = Number(price).toFixed(2);
                description = `${displayTicker} @ ${cleanPrice} × ${cleanQty}`;
            } else {
                description = `${displayTicker} × ${cleanQty}`;
            }
        } else if (isCashDepositType(normalizedTypeDesc) || isCashWithdrawalType(normalizedTypeDesc)) {
            description = getCashTransactionDescription(txn, normalizedTypeDesc);
        } else {
            description = getTransactionDescriptionText(txn);
        }

        const moneyMarketIdentity = resolveInvestmentMoneyMarketTransactionIdentity(txn);
        if (moneyMarketIdentity) {
            description = formatInvestmentMoneyMarketTransactionDescription(
                txn,
                moneyMarketIdentity,
                description,
            );
        }

        if (isKolRewardTransaction(txn)) {
            description = normalizeKolRewardDescription(description);
        }

        if (brokerCode === 'hsbc' && ['buy', 'sell'].includes(normalizedTypeDesc)) {
            const referenceSummary = getHsbcReferenceCodeSummary(txn);
            if (referenceSummary) {
                return normalizeTransactionDescriptionPresentation(`${description} · ${referenceSummary}`);
            }
        }

        return normalizeTransactionDescriptionPresentation(description);
    }

    function formatHoldingsMoney(value, { dashWhenZero = false } = {}) {
        if (value === null || value === undefined || Number.isNaN(value)) return '-';
        if (dashWhenZero && Math.abs(value) < 1e-9) return '-';
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
    }

    function formatSignedHoldingsMoney(value) {
        if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
        const numericValue = Number(value);
        if (Math.abs(numericValue) < 1e-9) return formatHoldingsMoney(0);
        return `${numericValue > 0 ? '+' : '-'}${formatHoldingsMoney(Math.abs(numericValue))}`;
    }

    function formatHoldingsPercent(value) {
        if (value === null || value === undefined || Number.isNaN(value)) return '-';
        return `${new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value)}%`;
    }

    function formatHoldingsUsd(value, { dashWhenNull = false } = {}) {
        if (value === null || value === undefined || Number.isNaN(value)) {
            return dashWhenNull ? '-' : '$0.00';
        }
        const sign = value < 0 ? '-' : '';
        return `${sign}$${formatHoldingsMoney(Math.abs(value))}`;
    }

    function formatHoldingsPosition(quantity) {
        if (quantity === null || quantity === undefined || Number.isNaN(quantity) || Math.abs(quantity) < 1e-9) {
            return '-';
        }
        const hasFraction = Math.abs(quantity - Math.round(quantity)) > 1e-9;
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: hasFraction ? 2 : 0,
            maximumFractionDigits: hasFraction ? 4 : 0,
        }).format(quantity);
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function shouldTrackHoldingTicker(txn) {
        const ticker = String(txn?.ticker || '').trim();
        if (!ticker) return false;
        const normalizedType = getNormalizedTransactionType(txn);
        if (['forex_trade', 'forex_trade_component', 'fx_translation_pnl'].includes(normalizedType)) return false;
        return !isForexPairTicker(ticker);
    }

    function isForexPairTicker(ticker) {
        return /^[A-Z]{3}\.[A-Z]{3}$/i.test(String(ticker || '').trim());
    }

    function isFlatPosition(value) {
        return !Number.isFinite(value) || Math.abs(value) < 1e-9;
    }

    function createPositionState(ticker) {
        return {
            ticker,
            shares: 0,
            totalCost: 0,
            realizedPnl: 0,
            nonPerformanceRealizedPnl: 0,
            realizedPnlByDate: {},
            lastCloseDate: null,
            lastTradeDate: null,
            buyCount: 0,
            buyQuantity: 0,
            sellCount: 0,
            sellQuantity: 0,
            brokerRealizedSellCount: 0,
            realizedPnlStatus: 'complete',
            hasPartialTaxLotHistory: false,
            costBasisStatus: 'known',
            costBasisMethod: null,
            lotMatchingMethod: null,
            lots: [],
            nextLotSequence: 0,
            lotScope: null,
        };
    }

    function normalizeInvestmentLotScopeAccount(broker, accountId) {
        const normalizedAccount = String(accountId || '').trim();
        if (String(broker || '').trim().toLowerCase() === 'ibkr') {
            const suffixMatch = normalizedAccount.toUpperCase().match(/^U(?:\*+|\d+)(\d{5})$/);
            if (suffixMatch) return `ibkr:u-suffix:${suffixMatch[1]}`;
        }
        return normalizedAccount.toLowerCase() || 'missing-account';
    }

    function getTransactionLotScope(txn, tickerOverride = '') {
        const broker = String(txn?.broker || txn?.source?.broker || '').trim().toLowerCase() || 'missing-broker';
        const institution = String(
            txn?.institution || txn?.source?.institution || broker,
        ).trim().toLowerCase() || broker;
        const accountId = String(
            txn?.account_id
            ?? txn?.account
            ?? txn?.source?.account_id
            ?? txn?.source?.account
            ?? '',
        ).trim();
        const accountType = String(
            txn?.account_type ?? txn?.source?.account_type ?? '',
        ).trim().toLowerCase() || 'missing-account-type';
        const ticker = getInvestmentCanonicalTicker(tickerOverride || txn?.ticker) || 'missing-ticker';
        const currency = String(formatTransactionCurrency(txn) || getTickerQuoteCurrency(ticker)).trim().toUpperCase()
            || 'MISSING-CURRENCY';
        const securityId = String(
            txn?.security_id
            ?? txn?.source?.security_id
            ?? txn?.source?.unique_id
            ?? txn?.source?.cusip
            ?? txn?.source?.isin
            ?? '',
        ).trim().toUpperCase() || 'MISSING-SECURITY-ID';
        return {
            broker,
            institution,
            accountId,
            accountToken: normalizeInvestmentLotScopeAccount(broker, accountId),
            accountType,
            ticker,
            currency,
            securityId,
        };
    }

    function getTransactionLotScopeKey(txn, tickerOverride = '') {
        const scope = getTransactionLotScope(txn, tickerOverride);
        return [
            scope.broker,
            scope.institution,
            scope.accountToken,
            scope.accountType,
            scope.ticker,
            scope.currency,
            scope.securityId,
        ].join('|');
    }

    function getTransactionBrokerRealizedPnl(txn) {
        const rawValue = (
            txn?.broker_realized_pnl_raw
            ?? txn?.broker_realized_pnl
            ?? txn?.normalized?.broker_realized_pnl
            ?? txn?.source?.broker_realized_pnl
        );
        if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') return null;
        const numericValue = Number(rawValue);
        return Number.isFinite(numericValue) ? numericValue : null;
    }

    function hasPartialTaxLotHistorySource(txn) {
        return new Set([
            'hsbc_order_status_text',
            'hsbc_order_status_capture',
            'ibkr_web_trade_notification',
        ]).has(String(txn?.source?.file_kind || '').trim().toLowerCase());
    }

    function getHsbcUsdSavingsCsvLedgerSequence(txn) {
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        if (String(source.file_kind || '').trim().toLowerCase() !== 'hsbc_usd_savings_csv') {
            return null;
        }
        const sequence = Number(source.ledger_sequence ?? source.row_number);
        return Number.isFinite(sequence) ? sequence : null;
    }

    function getInvestmentReplayIdentity(txn) {
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        return JSON.stringify([
            String(txn?.broker || source.broker || '').trim().toLowerCase(),
            String(
                txn?.account_id
                ?? txn?.account
                ?? source.account_id
                ?? source.account
                ?? source.account_number
                ?? '',
            ).trim(),
            String(txn?.date || '').trim(),
            String(txn?.datetime || '').trim(),
            String(getNormalizedTransactionType(txn) || '').trim(),
            String(getInvestmentCanonicalTicker(txn?.ticker) || '').trim(),
            String(formatTransactionCurrency(txn) || '').trim().toUpperCase(),
            String(txn?.quantity_raw ?? txn?.quantity ?? source.quantity_raw ?? '').trim(),
            String(txn?.price_raw ?? txn?.price ?? source.price_raw ?? '').trim(),
            String(txn?.net_amount_raw ?? txn?.amount ?? txn?.cash ?? '').trim(),
            String(source.order_id ?? source.execution_id ?? source.message_id ?? source.row_number ?? '').trim(),
            String(txn?.ledger_no ?? source.ledger_no ?? '').trim(),
        ]);
    }

    function compareInvestmentTransactions(leftTxn, rightTxn, leftIndex = 0, rightIndex = 0) {
        const leftDatetime = String(leftTxn?.datetime || leftTxn?.date || '');
        const rightDatetime = String(rightTxn?.datetime || rightTxn?.date || '');
        if (leftDatetime !== rightDatetime) {
            return leftDatetime.localeCompare(rightDatetime);
        }
        const leftDate = String(leftTxn?.date || '');
        const rightDate = String(rightTxn?.date || '');
        if (leftDate !== rightDate) {
            return leftDate.localeCompare(rightDate);
        }
        const leftSavingsSequence = getHsbcUsdSavingsCsvLedgerSequence(leftTxn);
        const rightSavingsSequence = getHsbcUsdSavingsCsvLedgerSequence(rightTxn);
        if (
            leftSavingsSequence !== null
            && rightSavingsSequence !== null
            && leftSavingsSequence !== rightSavingsSequence
        ) {
            // HSBC's downloaded USD Savings CSV is newest-first. Larger source
            // rows therefore belong earlier in the chronological replay.
            return rightSavingsSequence - leftSavingsSequence;
        }
        const leftBroker = String(leftTxn?.broker || leftTxn?.source?.broker || '').trim().toLowerCase();
        const rightBroker = String(rightTxn?.broker || rightTxn?.source?.broker || '').trim().toLowerCase();
        if (leftBroker === 'hsbc' && rightBroker === 'hsbc') {
            const leftCategory = getHsbcSortCategory(leftTxn);
            const rightCategory = getHsbcSortCategory(rightTxn);
            if (leftCategory !== rightCategory) {
                return leftCategory - rightCategory;
            }
            const leftSequence = getHsbcOrderSequenceNumber(leftTxn);
            const rightSequence = getHsbcOrderSequenceNumber(rightTxn);
            if (Number.isFinite(leftSequence) && Number.isFinite(rightSequence) && leftSequence !== rightSequence) {
                return leftSequence - rightSequence;
            }
        }
        const leftCashCategory = getSameTimeCashSafetySortCategory(leftTxn);
        const rightCashCategory = getSameTimeCashSafetySortCategory(rightTxn);
        if (leftCashCategory !== rightCashCategory) {
            return leftCashCategory - rightCashCategory;
        }
        const leftCashAmount = getTransactionCashSortAmount(leftTxn);
        const rightCashAmount = getTransactionCashSortAmount(rightTxn);
        if (leftCashCategory === 0 && leftCashAmount !== rightCashAmount) {
            return rightCashAmount - leftCashAmount;
        }
        if (leftCashCategory === 2 && leftCashAmount !== rightCashAmount) {
            return rightCashAmount - leftCashAmount;
        }
        const leftRow = Number(leftTxn?.source?.row_number);
        const rightRow = Number(rightTxn?.source?.row_number);
        if (Number.isFinite(leftRow) && Number.isFinite(rightRow) && leftRow !== rightRow) {
            return leftRow - rightRow;
        }
        const leftIdentity = getInvestmentReplayIdentity(leftTxn);
        const rightIdentity = getInvestmentReplayIdentity(rightTxn);
        if (leftIdentity !== rightIdentity) return leftIdentity.localeCompare(rightIdentity);
        return leftIndex - rightIndex;
    }

    function compareInvestmentTransactionsForReplay(leftTxn, rightTxn, leftIndex = 0, rightIndex = 0) {
        const leftDate = String(leftTxn?.date || '').slice(0, 10);
        const rightDate = String(rightTxn?.date || '').slice(0, 10);
        if (leftDate !== rightDate) {
            return leftDate.localeCompare(rightDate);
        }
        const leftDatetime = String(leftTxn?.datetime || leftTxn?.date || '');
        const rightDatetime = String(rightTxn?.datetime || rightTxn?.date || '');
        if (leftDatetime !== rightDatetime) {
            return leftDatetime.localeCompare(rightDatetime);
        }
        return compareInvestmentTransactions(leftTxn, rightTxn, leftIndex, rightIndex);
    }

    function compareInvestmentReplaySnapshots(leftSnapshot, rightSnapshot, leftIndex = 0, rightIndex = 0) {
        const leftDate = String(leftSnapshot?.date || '').slice(0, 10);
        const rightDate = String(rightSnapshot?.date || '').slice(0, 10);
        if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
        const leftOrder = Number(leftSnapshot?.replay_snapshot_order);
        const rightOrder = Number(rightSnapshot?.replay_snapshot_order);
        if (Number.isFinite(leftOrder) && Number.isFinite(rightOrder) && leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
        }
        return compareInvestmentTransactionsForReplay(leftSnapshot, rightSnapshot, leftIndex, rightIndex);
    }

    function getInvestmentTaxLotOrderDatetime(txn) {
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        return String(
            source.history_order_datetime
            ?? source.execution_datetime
            ?? source.trade_datetime
            ?? source.email_datetime
            ?? source.source_datetime_raw
            ?? txn?.datetime
            ?? txn?.date
            ?? '',
        ).trim();
    }

    function compareInvestmentTaxLotTransactions(leftTxn, rightTxn, leftIndex = 0, rightIndex = 0) {
        const leftDatetime = getInvestmentTaxLotOrderDatetime(leftTxn);
        const rightDatetime = getInvestmentTaxLotOrderDatetime(rightTxn);
        if (leftDatetime !== rightDatetime) {
            return leftDatetime.localeCompare(rightDatetime);
        }
        const leftDate = String(leftTxn?.date || '');
        const rightDate = String(rightTxn?.date || '');
        if (leftDate !== rightDate) {
            return leftDate.localeCompare(rightDate);
        }
        const leftBroker = String(leftTxn?.broker || leftTxn?.source?.broker || '').trim().toLowerCase();
        const rightBroker = String(rightTxn?.broker || rightTxn?.source?.broker || '').trim().toLowerCase();
        if (leftBroker === 'hsbc' && rightBroker === 'hsbc') {
            const leftSequence = getHsbcOrderSequenceNumber(leftTxn);
            const rightSequence = getHsbcOrderSequenceNumber(rightTxn);
            if (Number.isFinite(leftSequence) && Number.isFinite(rightSequence) && leftSequence !== rightSequence) {
                return leftSequence - rightSequence;
            }
        }
        const leftRow = Number(leftTxn?.source?.row_number ?? leftIndex);
        const rightRow = Number(rightTxn?.source?.row_number ?? rightIndex);
        if (Number.isFinite(leftRow) && Number.isFinite(rightRow) && leftRow !== rightRow) {
            return leftRow - rightRow;
        }
        return leftIndex - rightIndex;
    }

    function getAuthoritativeSnapshotFiniteNumber(value) {
        if (typeof value !== 'number' && typeof value !== 'string') return null;
        const normalizedValue = typeof value === 'string' ? value.trim() : value;
        if (normalizedValue === '') return null;
        const numericValue = Number(normalizedValue);
        return Number.isFinite(numericValue) ? numericValue : null;
    }

    function normalizeAuthoritativeCostBasis(snapshot) {
        const reportedStatus = String(snapshot?.cost_basis_status || '').trim().toLowerCase();
        const costPrice = getAuthoritativeSnapshotFiniteNumber(snapshot?.cost_price);
        if (reportedStatus === 'partial' || reportedStatus === 'unknown') {
            return { costBasisStatus: reportedStatus, costPrice: null };
        }
        if (costPrice === null) {
            return { costBasisStatus: 'unknown', costPrice: null };
        }
        return { costBasisStatus: 'known', costPrice };
    }

    function combineAuthoritativeCostBasisStatus(leftStatus, rightStatus) {
        const left = leftStatus === 'known' || leftStatus === 'partial'
            ? leftStatus
            : 'unknown';
        const right = rightStatus === 'known' || rightStatus === 'partial'
            ? rightStatus
            : 'unknown';
        if (left === 'known' && right === 'known') return 'known';
        if (left === 'unknown' && right === 'unknown') return 'unknown';
        return 'partial';
    }

    function normalizeAuthoritativePositionSnapshot(rawSnapshot) {
        if (!rawSnapshot || typeof rawSnapshot !== 'object') {
            return {};
        }
        const normalizedSnapshot = {};
        Object.entries(rawSnapshot).forEach(([ticker, snapshot]) => {
            const normalizedTicker = normalizeInvestmentTicker(ticker);
            if (!normalizedTicker || !snapshot || typeof snapshot !== 'object') return;
            const quantity = getAuthoritativeSnapshotFiniteNumber(snapshot.quantity);
            const { costBasisStatus, costPrice } = normalizeAuthoritativeCostBasis(snapshot);
            const marketValue = (
                getAuthoritativeSnapshotFiniteNumber(snapshot.market_value)
                ?? getAuthoritativeSnapshotFiniteNumber(snapshot.value)
            );
            const lastPrice = (
                getAuthoritativeSnapshotFiniteNumber(snapshot.last_price)
                ?? getAuthoritativeSnapshotFiniteNumber(snapshot.close_price)
            );
            normalizedSnapshot[normalizedTicker] = {
                quantity: quantity ?? 0,
                costBasisStatus,
                costPrice,
                marketValue,
                lastPrice,
            };
        });
        return normalizedSnapshot;
    }

    function getAuthoritativePositionSnapshot() {
        if (window.ANTIGRAVITY_INVESTMENT_DATA?.summary?.position_snapshot_authoritative !== true) {
            return null;
        }
        return normalizeAuthoritativePositionSnapshot(
            window.ANTIGRAVITY_INVESTMENT_DATA?.position_snapshot,
        );
    }

    function getAuthoritativeBrokerPositionSnapshots() {
        const brokerSummaries = window.ANTIGRAVITY_INVESTMENT_DATA?.broker_summaries;
        if (!brokerSummaries || typeof brokerSummaries !== 'object') return [];
        const snapshots = [];
        Object.entries(brokerSummaries).forEach(([broker, summary]) => {
            if (!summary || typeof summary !== 'object') return;
            if (summary.position_snapshot_authoritative !== true) return;
            const rawSnapshot = summary.position_snapshot;
            if (!rawSnapshot || typeof rawSnapshot !== 'object') return;
            const normalizedBroker = String(broker || summary.broker || '').trim().toLowerCase();
            if (!normalizedBroker) return;
            snapshots.push({
                broker: normalizedBroker,
                accountId: String(summary.account_id ?? summary.account ?? '').trim(),
                positionSnapshot: normalizeAuthoritativePositionSnapshot(rawSnapshot),
                holdingsValidation: summary.holdings_validation && typeof summary.holdings_validation === 'object'
                    ? summary.holdings_validation
                    : null,
            });
        });
        return snapshots;
    }

    function getAuthoritativePositionSnapshotForTransactions(transactions = []) {
        const globalSnapshot = getAuthoritativePositionSnapshot();
        if (globalSnapshot !== null) return globalSnapshot;
        const scopedTransactions = Array.isArray(transactions) ? transactions : [];
        const brokerCodes = new Set(
            scopedTransactions
                .map((txn) => String(txn?.broker || txn?.source?.broker || '').trim().toLowerCase())
                .filter(Boolean),
        );
        if (brokerCodes.size !== 1) return null;
        const broker = [...brokerCodes][0];
        const accountIds = new Set(
            scopedTransactions
                .map((txn) => String(txn?.account || txn?.source?.account || '').trim())
                .filter(Boolean),
        );
        const candidates = getAuthoritativeBrokerPositionSnapshots().filter((entry) => (
            entry.broker === broker
            && (!accountIds.size || !entry.accountId || accountIds.has(entry.accountId))
        ));
        if (candidates.length !== 1) return null;
        return candidates[0].positionSnapshot;
    }

    function normalizeAuthoritativePerformanceSnapshot(rawSnapshot) {
        if (!rawSnapshot || typeof rawSnapshot !== 'object') {
            return {};
        }
        const normalizedSnapshot = {};
        Object.entries(rawSnapshot).forEach(([ticker, snapshot]) => {
            const normalizedTicker = getInvestmentCanonicalTicker(ticker);
            if (!normalizedTicker || !snapshot || typeof snapshot !== 'object') return;
            const realizedTotal = Number(snapshot.realized_total);
            if (!Number.isFinite(realizedTotal)) return;
            normalizedSnapshot[normalizedTicker] = {
                realizedTotal,
                currency: String(snapshot.currency || getTickerQuoteCurrency(normalizedTicker)).trim().toUpperCase(),
                includesNonperformance: snapshot.realized_total_includes_nonperformance === true,
            };
        });
        return normalizedSnapshot;
    }

    function getAuthoritativePerformanceSnapshot() {
        if (window.ANTIGRAVITY_INVESTMENT_DATA?.summary?.performance_snapshot_authoritative !== true) {
            return null;
        }
        return normalizeAuthoritativePerformanceSnapshot(
            window.ANTIGRAVITY_INVESTMENT_DATA?.performance_snapshot,
        );
    }

    function getAuthoritativeBrokerPerformanceSnapshots() {
        const brokerSummaries = window.ANTIGRAVITY_INVESTMENT_DATA?.broker_summaries;
        if (!brokerSummaries || typeof brokerSummaries !== 'object') return [];
        const snapshots = [];
        Object.entries(brokerSummaries).forEach(([broker, summary]) => {
            if (!summary || typeof summary !== 'object') return;
            if (summary.performance_snapshot_authoritative !== true) return;
            const normalizedBroker = String(broker || summary.broker || '').trim().toLowerCase();
            if (!normalizedBroker) return;
            const accountId = String(summary.account_id ?? summary.account ?? '').trim();
            snapshots.push({
                broker: normalizedBroker,
                accountId,
                accountToken: normalizeInvestmentLotScopeAccount(normalizedBroker, accountId),
                performanceSnapshot: normalizeAuthoritativePerformanceSnapshot(
                    summary.performance_snapshot,
                ),
            });
        });
        return snapshots;
    }

    function getVerifiedTaxLotHistoryScopes() {
        const brokerSummaries = window.ANTIGRAVITY_INVESTMENT_DATA?.broker_summaries;
        const scopes = new Map();
        if (!brokerSummaries || typeof brokerSummaries !== 'object') return scopes;
        Object.entries(brokerSummaries).forEach(([broker, summary]) => {
            if (!summary || typeof summary !== 'object') return;
            const normalizedBroker = String(broker || summary.broker || '').trim().toLowerCase();
            const accountId = String(summary.account_id ?? summary.account ?? '').trim();
            if (!normalizedBroker || !accountId) return;
            const accountToken = normalizeInvestmentLotScopeAccount(normalizedBroker, accountId);
            const rawVerifications = summary.tax_lot_history_verifications;
            if (!rawVerifications || typeof rawVerifications !== 'object') return;
            Object.entries(rawVerifications).forEach(([ticker, rawVerification]) => {
                if (!rawVerification || typeof rawVerification !== 'object') return;
                const normalizedTicker = getInvestmentCanonicalTicker(ticker);
                const currency = String(rawVerification.currency || '').trim().toUpperCase();
                const verifiedThrough = normalizeLedgerDate(rawVerification.verified_through);
                const buyCount = Number(rawVerification.buy_count);
                const sellCount = Number(rawVerification.sell_count);
                const buyQuantity = Number(rawVerification.buy_quantity);
                const sellQuantity = Number(rawVerification.sell_quantity);
                if (
                    !normalizedTicker
                    || !currency
                    || !verifiedThrough
                    || !Number.isInteger(buyCount)
                    || buyCount < 0
                    || !Number.isInteger(sellCount)
                    || sellCount < 0
                    || !Number.isFinite(buyQuantity)
                    || buyQuantity < 0
                    || !Number.isFinite(sellQuantity)
                    || sellQuantity < 0
                ) return;
                scopes.set([
                    normalizedBroker,
                    accountToken,
                    normalizedTicker,
                    currency,
                ].join('|'), {
                    verifiedThrough,
                    buyCount,
                    sellCount,
                    buyQuantity,
                    sellQuantity,
                    calculationMethod: String(rawVerification.calculation_method || '').trim(),
                    verificationSource: String(rawVerification.verification_source || '').trim(),
                });
            });
        });
        return scopes;
    }

    function getDynamicallyVerifiedTaxLotHistoryScopes(lotScopeMap) {
        const brokerSummaries = window.ANTIGRAVITY_INVESTMENT_DATA?.broker_summaries;
        const scopes = new Map();
        if (!brokerSummaries || typeof brokerSummaries !== 'object') return scopes;

        const closeEnough = (left, right) => Math.abs(Number(left) - Number(right)) < 1e-9;
        const getCoverageEndDate = (scopeSummary, snapshot) => {
            const coverage = scopeSummary?.order_history_scope
                || snapshot?.order_status_coverage;
            if (coverage?.mode !== 'explicit_date_ranges' || !Array.isArray(coverage.windows)) {
                return '';
            }
            return coverage.windows
                .map((window) => normalizeLedgerDate(window?.end_date))
                .filter(Boolean)
                .sort()
                .pop() || '';
        };

        lotScopeMap.forEach((scopeState) => {
            const scope = scopeState?.lotScope;
            if (!scope || scope.broker !== 'hsbc') return;

            const matchingSummary = Object.entries(brokerSummaries).find(([broker, summary]) => {
                if (!summary || typeof summary !== 'object') return false;
                const normalizedBroker = String(broker || summary.broker || '').trim().toLowerCase();
                const accountId = String(summary.account_id ?? summary.account ?? '').trim();
                return (
                    normalizedBroker === scope.broker
                    && normalizeInvestmentLotScopeAccount(normalizedBroker, accountId) === scope.accountToken
                );
            });
            const summary = matchingSummary?.[1];
            const snapshot = summary?.hsbc_snapshot;
            if (
                !summary
                || summary.position_snapshot_authoritative !== true
                || snapshot?.status !== 'validated'
                || scopeState.realizedPnlStatus !== 'complete'
                || scopeState.sellCount <= scopeState.brokerRealizedSellCount
                || scopeState.hasPartialTaxLotHistory !== true
            ) return;

            const positionSnapshotEntry = Object.entries(summary.position_snapshot || {})
                .find(([ticker]) => getInvestmentCanonicalTicker(ticker) === scope.ticker)?.[1];
            const expectedShares = Number(positionSnapshotEntry?.quantity);
            const verifiedThrough = normalizeLedgerDate(summary.position_snapshot_as_of)
                || normalizeLedgerDate(snapshot.portfolio_market_data_updated_at?.date);
            const coverageEndDate = getCoverageEndDate(summary, snapshot);
            if (
                !positionSnapshotEntry
                || !Number.isFinite(expectedShares)
                || !verifiedThrough
                || !coverageEndDate
                || coverageEndDate < verifiedThrough
                || !scopeState.lastTradeDate
                || scopeState.lastTradeDate > verifiedThrough
                || !closeEnough(scopeState.shares, expectedShares)
            ) return;

            scopes.set([
                scope.broker,
                scope.accountToken,
                scope.ticker,
                scope.currency,
            ].join('|'), {
                verifiedThrough,
                expectedShares,
                buyCount: scopeState.buyCount,
                sellCount: scopeState.sellCount,
                buyQuantity: scopeState.buyQuantity,
                sellQuantity: scopeState.sellQuantity,
                calculationMethod: 'trade_price_and_commission',
                verificationSource: 'authoritative_position_snapshot_and_complete_replay',
            });
        });
        return scopes;
    }

    function matchesVerifiedTaxLotHistory(scopeState, verification) {
        if (!verification) return false;
        const hasExpectedShares = (
            verification.expectedShares !== undefined
            && verification.expectedShares !== null
            && Number.isFinite(Number(verification.expectedShares))
        );
        if (!hasExpectedShares && !isFlatPosition(scopeState?.shares)) return false;
        const closeEnough = (left, right) => Math.abs(Number(left) - Number(right)) < 1e-9;
        return (
            scopeState.realizedPnlStatus === 'complete'
            && scopeState.lastTradeDate
            && scopeState.lastTradeDate <= verification.verifiedThrough
            && scopeState.buyCount === verification.buyCount
            && scopeState.sellCount === verification.sellCount
            && closeEnough(scopeState.buyQuantity, verification.buyQuantity)
            && closeEnough(scopeState.sellQuantity, verification.sellQuantity)
            && (!hasExpectedShares || closeEnough(scopeState.shares, verification.expectedShares))
        );
    }

    function getTransactionEffectiveUnitPrice(txn, quantityOverride = null) {
        const quantity = quantityOverride ?? getTransactionQuantity(txn);
        if (quantity !== null && Number.isFinite(quantity) && quantity > 0) {
            if (txn?.normalized?.net_amount !== undefined && txn?.normalized?.net_amount !== null) {
                const normalizedAmount = Number(txn.normalized.net_amount);
                if (Number.isFinite(normalizedAmount) && Math.abs(normalizedAmount) > 1e-9) {
                    return Math.abs(normalizedAmount) / quantity;
                }
            }
            const normalizedType = getNormalizedTransactionType(txn);
            const economicAmount = getTransactionEconomicAmount(txn);
            const commission = Math.abs(getTransactionCommission(txn));
            if (Number.isFinite(economicAmount) && Math.abs(economicAmount) > 1e-9) {
                if (normalizedType === 'buy') {
                    return (Math.abs(economicAmount) + commission) / quantity;
                }
                if (normalizedType === 'sell') {
                    return Math.max(0, Math.abs(economicAmount) - commission) / quantity;
                }
                return Math.abs(economicAmount) / quantity;
            }
        }
        const price = getTransactionPrice(txn);
        return Number.isFinite(price) ? price : 0;
    }

    function getTransactionDerivedCostBasis(txn, prefix = 'carried') {
        const basisPrefix = prefix === 'transfer_out'
            ? 'transfer_out_cost_basis'
            : 'carried_cost_basis';
        const status = String(txn?.[`${basisPrefix}_status`] || '').trim().toLowerCase();
        if (status !== 'known') return null;
        const rawBasis = txn?.[`${basisPrefix}_raw`];
        if (rawBasis === undefined || rawBasis === null || String(rawBasis).trim() === '') return null;
        const numericBasis = Number(rawBasis);
        return Number.isFinite(numericBasis) && numericBasis >= 0 ? numericBasis : null;
    }

    function getTransactionDerivedCostBasisMethod(txn, prefix = 'carried') {
        const basisPrefix = prefix === 'transfer_out'
            ? 'transfer_out_cost_basis'
            : 'carried_cost_basis';
        return String(
            txn?.[`${basisPrefix}_method_label`]
            || txn?.[`${basisPrefix}_method`]
            || '',
        ).trim();
    }

    function markReconstructedCostBasis(state, txn, prefix, status) {
        const method = getTransactionDerivedCostBasisMethod(txn, prefix);
        if (method) state.costBasisMethod = method === 'fifo_reconstructed' ? 'FIFO reconstructed' : method;
        const normalizedStatus = String(status || '').trim().toLowerCase();
        if (normalizedStatus === 'known') return;
        if (normalizedStatus === 'partial' || normalizedStatus === 'unknown') {
            state.costBasisStatus = normalizedStatus;
        }
    }

    function applyInvestmentTransactionToState(
        summary,
        txn,
        normalizedType,
        quantity,
        amount,
        ledgerDate,
        {
            preferBrokerRealizedPnl = false,
            preferTradePriceAndCommission = false,
            unitPriceOverride = null,
        } = {},
    ) {
        summary.hasPartialTaxLotHistory = (
            summary.hasPartialTaxLotHistory || hasPartialTaxLotHistorySource(txn)
        );
        const resolveTradeUnitPrice = () => {
            if (unitPriceOverride !== null && Number.isFinite(Number(unitPriceOverride))) {
                return Number(unitPriceOverride);
            }
            return preferTradePriceAndCommission
                ? getTransactionTradePriceAndCommissionUnitPrice(txn, quantity)
                : getTransactionEffectiveUnitPrice(txn, quantity);
        };
        if (normalizedType === 'buy' && quantity !== null && !Number.isNaN(quantity)) {
            summary.buyCount += 1;
            summary.buyQuantity += quantity;
            summary.lastTradeDate = ledgerDate || summary.lastTradeDate;
            applyDirectionalTrade(summary, 'long', quantity, resolveTradeUnitPrice());
            if (isFlatPosition(summary.shares)) summary.lastCloseDate = ledgerDate;
            return 0;
        }
        if (normalizedType === 'grant' && quantity !== null && !Number.isNaN(quantity)) {
            openPositionLots(summary, 'long', quantity, 0);
            if (isFlatPosition(summary.shares)) summary.lastCloseDate = ledgerDate;
            return 0;
        }
        // Dividend reinvestment is funded by a separate dividend cash flow.
        if (normalizedType === 'dividend_reinvestment' && quantity !== null && !Number.isNaN(quantity)) {
            openPositionLots(summary, 'long', quantity, 0);
            if (isFlatPosition(summary.shares)) summary.lastCloseDate = ledgerDate;
            return 0;
        }
        if (normalizedType === 'sell' && quantity !== null && !Number.isNaN(quantity)) {
            const sharesBeforeSell = Number(summary.shares) || 0;
            const realizedBeforeSell = Number(summary.realizedPnl) || 0;
            applyDirectionalTrade(summary, 'short', quantity, resolveTradeUnitPrice());
            summary.sellCount += 1;
            summary.sellQuantity += quantity;
            summary.lastTradeDate = ledgerDate || summary.lastTradeDate;
            const brokerRealizedPnl = preferBrokerRealizedPnl
                ? getTransactionBrokerRealizedPnl(txn)
                : null;
            if (brokerRealizedPnl !== null) {
                summary.realizedPnl = realizedBeforeSell + brokerRealizedPnl;
                summary.brokerRealizedSellCount += 1;
            } else if (sharesBeforeSell < quantity - 1e-9) {
                summary.realizedPnlStatus = 'incomplete';
            }
            if (isFlatPosition(summary.shares)) summary.lastCloseDate = ledgerDate;
            return (Number(summary.realizedPnl) || 0) - realizedBeforeSell;
        }
        if (normalizedType === 'transfer_in' && quantity !== null && !Number.isNaN(quantity)) {
            const carriedCostBasis = getTransactionDerivedCostBasis(txn, 'carried');
            if (carriedCostBasis !== null) {
                openPositionLots(summary, 'long', quantity, carriedCostBasis / quantity);
                markReconstructedCostBasis(
                    summary,
                    txn,
                    'carried',
                    txn?.carried_cost_basis_status,
                );
            } else {
                // Preserve existing lot identities. Unknown carried basis is represented by
                // a zero-cost lot and remains marked unknown below; it must not erase lots
                // that were opened before the transfer receipt.
                openPositionLots(summary, 'long', quantity, 0);
                markReconstructedCostBasis(
                    summary,
                    txn,
                    'carried',
                    txn?.carried_cost_basis_status || 'unknown',
                );
            }
            if (isFlatPosition(summary.shares)) summary.lastCloseDate = ledgerDate;
            return 0;
        }
        if (normalizedType === 'transfer_out' && quantity !== null && !Number.isNaN(quantity)) {
            const transferredCostBasis = getTransactionDerivedCostBasis(txn, 'transfer_out');
            const sharesBeforeTransfer = Number(summary.shares) || 0;
            if (sharesBeforeTransfer > 1e-9) {
                removePositionLots(summary, quantity, {
                    basisOverride: transferredCostBasis,
                });
            } else {
                summary.shares -= quantity;
            }
            markReconstructedCostBasis(
                summary,
                txn,
                'transfer_out',
                transferredCostBasis !== null
                    ? txn?.transfer_out_cost_basis_status
                    : txn?.transfer_out_cost_basis_status || 'unknown',
            );
            if (isFlatPosition(summary.shares)) summary.lastCloseDate = ledgerDate;
            return 0;
        }
        if (
            ['dividend', 'foreign_tax_withholding', 'payment_in_lieu', 'adjustment'].includes(normalizedType)
            && txn?.source?.excluded_from_broker_pnl !== true
        ) {
            summary.realizedPnl += amount;
            summary.nonPerformanceRealizedPnl += amount;
            return amount;
        }
        return 0;
    }

    function getTransactionTradePriceAndCommissionUnitPrice(txn, quantityOverride = null) {
        const quantity = quantityOverride ?? getTransactionQuantity(txn);
        const price = getTransactionPrice(txn);
        if (
            quantity === null
            || !Number.isFinite(quantity)
            || quantity <= 0
            || !Number.isFinite(price)
            || price < 0
        ) {
            return getTransactionEffectiveUnitPrice(txn, quantityOverride);
        }
        const commissionPerShare = Math.abs(getTransactionCommission(txn)) / quantity;
        return getNormalizedTransactionType(txn) === 'sell'
            ? Math.max(0, price - commissionPerShare)
            : price + commissionPerShare;
    }

    const INVESTMENT_COST_BASIS_METHODS = new Set([
        'lowest_cost_first',
        'fifo',
        'lifo',
        'moving_average',
    ]);

    function normalizeInvestmentCostBasisMethod(value) {
        const normalized = String(value || '').trim().toLowerCase();
        return INVESTMENT_COST_BASIS_METHODS.has(normalized)
            ? normalized
            : 'lowest_cost_first';
    }

    function getInvestmentCostBasisMethod() {
        return normalizeInvestmentCostBasisMethod(
            globalThis.window?.ANTIGRAVITY_INVESTMENT_DATA?.investment_cost_basis_method
            ?? globalThis.window?.ANTIGRAVITY_APP?.investmentCostBasisMethod,
        );
    }

    const INVESTMENT_LINEAGE_PROXY_TICKERS = new Set(['SPY', 'SPY.US']);

    function getInvestmentIdentityStoreAliasCandidates(ticker) {
        return getInvestmentTickerStoreAliasCandidates(ticker)
            .filter((candidate) => !INVESTMENT_LINEAGE_PROXY_TICKERS.has(candidate));
    }

    function getIndexedClosePriceForTransaction(txn, tickerPriceIndex) {
        const valuationDate = normalizeLedgerDate(txn?.date);
        if (!valuationDate || !tickerPriceIndex) return null;
        const candidates = [];
        const addCandidate = (value) => {
            const normalizedCandidate = normalizeInvestmentTicker(value);
            if (normalizedCandidate && !candidates.includes(normalizedCandidate)) {
                candidates.push(normalizedCandidate);
            }
        };
        addCandidate(txn?.ticker);
        addCandidate(getInvestmentCanonicalTicker(txn?.ticker));
        getInvestmentIdentityStoreAliasCandidates(txn?.ticker).forEach(addCandidate);
        for (let index = 0; index < candidates.length; index += 1) {
            const close = getIndexedClosePriceOnOrBefore(tickerPriceIndex[candidates[index]], valuationDate);
            if (Number.isFinite(close) && close > 0) {
                return close;
            }
        }
        return null;
    }

    function normalizeRenderedSplitFactor(factor) {
        if (!Number.isFinite(factor) || factor <= 0 || factor < 1) return 1;
        const roundedFactor = Math.round(factor);
        return Math.abs(factor - roundedFactor) < 0.08 && roundedFactor >= 2 ? roundedFactor : factor;
    }

    function getTransactionRenderedSplitFactor(txn, tickerPriceIndex) {
        if (!shouldTrackHoldingTicker(txn)) return 1;
        const normalizedType = getNormalizedTransactionType(txn);
        if (!['buy', 'sell', 'grant', 'dividend_reinvestment'].includes(normalizedType)) return 1;
        const rawPrice = getTransactionPrice(txn);
        if (!Number.isFinite(rawPrice) || rawPrice <= 0) return 1;
        const renderedClose = getIndexedClosePriceForTransaction(txn, tickerPriceIndex);
        const adjustedPrice = adjustTradePriceForRenderedSeries(rawPrice, renderedClose);
        if (!Number.isFinite(adjustedPrice) || adjustedPrice <= 0) return 1;
        return normalizeRenderedSplitFactor(rawPrice / adjustedPrice);
    }

    function getRenderedSplitFactorHintKey(txn) {
        const ticker = getInvestmentCanonicalTicker(txn?.ticker);
        const date = normalizeLedgerDate(txn?.date);
        return ticker && date ? `${ticker}|${date}` : '';
    }

    function buildRenderedSplitFactorHints(transactions, tickerPriceIndex) {
        const buckets = new Map();
        const factorEvidenceByTicker = new Map();
        (Array.isArray(transactions) ? transactions : []).forEach((txn) => {
            if (!shouldTrackHoldingTicker(txn)) return;
            const normalizedType = getNormalizedTransactionType(txn);
            if (!['buy', 'sell', 'dividend_reinvestment'].includes(normalizedType)) return;
            const key = getRenderedSplitFactorHintKey(txn);
            if (!key) return;
            const factor = getTransactionRenderedSplitFactor(txn, tickerPriceIndex);
            if (!Number.isFinite(factor) || factor < 1 || Math.abs(factor - 1) < 1e-9) return;
            const ticker = getInvestmentCanonicalTicker(txn?.ticker);
            if (ticker) {
                if (!factorEvidenceByTicker.has(ticker)) {
                    factorEvidenceByTicker.set(ticker, []);
                }
                factorEvidenceByTicker.get(ticker).push(factor);
            }
            if (!buckets.has(key)) {
                buckets.set(key, []);
            }
            buckets.get(key).push(factor);
        });
        const dominantFactorByTicker = new Map();
        factorEvidenceByTicker.forEach((evidence, ticker) => {
            const roundedCounts = new Map();
            evidence.forEach((factor) => {
                const roundedKey = factor.toFixed(8);
                roundedCounts.set(roundedKey, (Number(roundedCounts.get(roundedKey)) || 0) + 1);
            });
            const rankedFactors = Array.from(roundedCounts.entries())
                .sort((left, right) => right[1] - left[1] || Number(left[0]) - Number(right[0]));
            const [bestFactor, bestCount] = rankedFactors[0] || [];
            const secondCount = Number(rankedFactors[1]?.[1]) || 0;
            const numericFactor = Number(bestFactor);
            if (
                Number.isFinite(numericFactor)
                && numericFactor > 1
                && bestCount >= 3
                && (secondCount === 0 || bestCount >= secondCount * 2)
            ) {
                dominantFactorByTicker.set(ticker, {
                    factor: numericFactor,
                    count: bestCount,
                });
            }
        });
        const hints = new Map();
        const dominantFactorCorrections = new Map();
        buckets.forEach((factors, key) => {
            const roundedCounts = new Map();
            factors.forEach((factor) => {
                const roundedKey = factor.toFixed(8);
                roundedCounts.set(roundedKey, (Number(roundedCounts.get(roundedKey)) || 0) + 1);
            });
            const [bestFactor] = Array.from(roundedCounts.entries())
                .sort((left, right) => right[1] - left[1] || Number(left[0]) - Number(right[0]))[0] || [];
            const numericFactor = Number(bestFactor);
            if (Number.isFinite(numericFactor) && numericFactor >= 1) {
                hints.set(key, numericFactor);
            }
        });

        // A trade can be far enough from that day's close to miss the strict
        // per-row split match even though sibling trades for the same ticker
        // prove the rendered price basis. Use the nearest proven factor only
        // when the raw-to-rendered ratio still falls within the normal close
        // movement tolerance. This preserves post-split rows whose ratio is
        // near 1 while repairing noisy pre-split rows such as old TQQQ fills.
        (Array.isArray(transactions) ? transactions : []).forEach((txn) => {
            const key = getRenderedSplitFactorHintKey(txn);
            const ticker = getInvestmentCanonicalTicker(txn?.ticker);
            if (!key || !ticker || hints.has(key)) return;
            const evidence = factorEvidenceByTicker.get(ticker);
            if (!Array.isArray(evidence) || !evidence.length) return;
            const rawPrice = getTransactionPrice(txn);
            const renderedClose = getIndexedClosePriceForTransaction(txn, tickerPriceIndex);
            if (!Number.isFinite(rawPrice) || rawPrice <= 0 || !Number.isFinite(renderedClose) || renderedClose <= 0) {
                return;
            }
            const rawRatio = rawPrice / renderedClose;
            if (!Number.isFinite(rawRatio) || rawRatio <= 0) return;
            const bestFactor = evidence
                .reduce((best, factor) => (
                    Math.abs(Math.log(rawRatio / factor)) < best.distance
                        ? {factor, distance: Math.abs(Math.log(rawRatio / factor))}
                        : best
                ), {factor: 1, distance: Number.POSITIVE_INFINITY});
            if (
                Number.isFinite(bestFactor.factor)
                && bestFactor.factor > 1
                && bestFactor.distance <= Math.log(1.35)
            ) {
                hints.set(key, bestFactor.factor);
            }
        });

        // A single fill can produce a plausible but wrong common split factor
        // when its raw price happens to be close to another candidate. If the
        // ticker has overwhelming sibling evidence for one factor, prefer that
        // factor for the isolated row while keeping the normal close movement
        // tolerance. This keeps a noisy TQQQ 1.5× inference from leaving 12.50
        // phantom shares after a genuinely flat 2-for-1-adjusted sequence.
        (Array.isArray(transactions) ? transactions : []).forEach((txn) => {
            const key = getRenderedSplitFactorHintKey(txn);
            const ticker = getInvestmentCanonicalTicker(txn?.ticker);
            const dominant = dominantFactorByTicker.get(ticker);
            if (!key || !ticker || !dominant) return;
            const currentFactor = getTransactionRenderedSplitFactor(txn, tickerPriceIndex);
            if (
                Number.isFinite(currentFactor)
                && currentFactor > 0
                && Math.abs(Math.log(currentFactor / dominant.factor)) <= Math.log(1.12)
            ) {
                return;
            }
            const rawPrice = getTransactionPrice(txn);
            const renderedClose = getIndexedClosePriceForTransaction(txn, tickerPriceIndex);
            if (!Number.isFinite(rawPrice) || rawPrice <= 0 || !Number.isFinite(renderedClose) || renderedClose <= 0) {
                return;
            }
            const rawRatio = rawPrice / renderedClose;
            const dominantDistance = Math.abs(Math.log(rawRatio / dominant.factor));
            if (Number.isFinite(rawRatio) && rawRatio > 0 && dominantDistance <= Math.log(1.35)) {
                hints.set(key, dominant.factor);
                dominantFactorCorrections.set(key, dominant.factor);
            }
        });
        hints.dominantFactorCorrections = dominantFactorCorrections;
        return hints;
    }

    function hasAuthoritativeImportedPositionQuantity(txn) {
        const normalizedType = getNormalizedTransactionType(txn);
        if (!['buy', 'sell', 'dividend_reinvestment'].includes(normalizedType)) return false;
        if (
            txn?.normalized?.position_quantity !== undefined
            && txn?.normalized?.position_quantity !== null
            && String(txn.normalized.position_quantity).trim() !== ''
        ) {
            return true;
        }
        if (txn?.quantity_abs !== undefined && txn?.quantity_abs !== null && String(txn.quantity_abs).trim() !== '') {
            return true;
        }
        if (txn?.quantity_raw !== undefined && txn?.quantity_raw !== null && String(txn.quantity_raw).trim() !== '') {
            return true;
        }
        return false;
    }

    function getTransactionValuationQuantity(txn, tickerPriceIndex, renderedSplitFactorHints = null) {
        const quantity = getTransactionQuantity(txn);
        if (!Number.isFinite(quantity)) return quantity;
        const normalizedType = getNormalizedTransactionType(txn);
        let factor = getTransactionRenderedSplitFactor(txn, tickerPriceIndex);
        if (
            ['buy', 'sell', 'grant', 'dividend_reinvestment'].includes(normalizedType)
            && renderedSplitFactorHints instanceof Map
        ) {
            const hintKey = getRenderedSplitFactorHintKey(txn);
            const hintedFactor = renderedSplitFactorHints.get(hintKey);
            const dominantHintedFactor = renderedSplitFactorHints.dominantFactorCorrections instanceof Map
                ? renderedSplitFactorHints.dominantFactorCorrections.get(hintKey)
                : null;
            if (Number.isFinite(dominantHintedFactor) && dominantHintedFactor >= 1) {
                factor = dominantHintedFactor;
            } else if (
                (!Number.isFinite(factor) || factor <= 1)
                && Number.isFinite(hintedFactor)
                && hintedFactor >= 1
            ) {
                factor = hintedFactor;
            }
        }
        if (
            hasAuthoritativeImportedPositionQuantity(txn)
            && (!Number.isFinite(factor) || factor <= 1)
        ) {
            return quantity;
        }
        return quantity * (Number.isFinite(factor) && factor > 0 ? factor : 1);
    }

    function resetPositionState(state) {
        state.shares = 0;
        state.totalCost = 0;
        state.lots = [];
        state.nextLotSequence = 0;
    }

    function ensurePositionLots(state) {
        if (!Array.isArray(state.lots)) state.lots = [];
        if (state.lots.length || isFlatPosition(state.shares)) return state.lots;
        const shares = Number(state.shares) || 0;
        const totalCost = Number(state.totalCost) || 0;
        const averagePrice = Math.abs(shares) > 1e-9 ? totalCost / Math.abs(shares) : 0;
        state.lots.push({
            quantity: shares,
            unitPrice: Number.isFinite(averagePrice) ? averagePrice : 0,
            sequence: Number(state.nextLotSequence) || 0,
        });
        state.nextLotSequence = (Number(state.nextLotSequence) || 0) + 1;
        return state.lots;
    }

    function openPositionLots(state, side, quantity, unitPrice) {
        if (!Number.isFinite(quantity) || quantity <= 0) return;
        ensurePositionLots(state);
        const safeUnitPrice = Number.isFinite(Number(unitPrice)) ? Number(unitPrice) : 0;
        const signedQuantity = side === 'short' ? -quantity : quantity;
        state.shares += signedQuantity;
        state.totalCost += safeUnitPrice * quantity;
        state.lotMatchingMethod = getInvestmentCostBasisMethod();
        state.lots.push({
            quantity: signedQuantity,
            unitPrice: safeUnitPrice,
            sequence: Number(state.nextLotSequence) || 0,
        });
        state.nextLotSequence = (Number(state.nextLotSequence) || 0) + 1;
    }

    function getLotsForClosing(state, side) {
        const method = getInvestmentCostBasisMethod();
        const sign = side === 'short' ? -1 : 1;
        const lots = ensurePositionLots(state).filter((lot) => (
            Math.sign(Number(lot?.quantity) || 0) === sign
            && Math.abs(Number(lot?.quantity) || 0) > 1e-9
            && Number.isFinite(Number(lot?.unitPrice))
        ));
        const sequenceOrder = (left, right) => (
            (Number(left?.sequence) || 0) - (Number(right?.sequence) || 0)
        );
        if (method === 'fifo') return lots.sort(sequenceOrder);
        if (method === 'lifo') return lots.sort((left, right) => sequenceOrder(right, left));
        if (method === 'lowest_cost_first') {
            return lots.sort((left, right) => {
                const priceDelta = sign > 0
                    ? Number(left.unitPrice) - Number(right.unitPrice)
                    : Number(right.unitPrice) - Number(left.unitPrice);
                return Math.abs(priceDelta) > 1e-9 ? priceDelta : sequenceOrder(left, right);
            });
        }
        return lots;
    }

    function consumePositionLots(state, quantity, {useAverage = false} = {}) {
        if (!Number.isFinite(quantity) || quantity <= 0 || isFlatPosition(state.shares)) {
            return {removedQuantity: 0, removedCost: 0};
        }
        const sign = state.shares > 0 ? 1 : -1;
        const originalShares = Number(state.shares) || 0;
        const originalTotalCost = Number(state.totalCost) || 0;
        if (useAverage) {
            const averagePrice = Math.abs(originalShares) > 1e-9
                ? originalTotalCost / Math.abs(originalShares)
                : 0;
            state.lots = [{
                quantity: originalShares,
                unitPrice: averagePrice,
                sequence: Number(state.nextLotSequence) || 0,
            }];
        }
        const lots = getLotsForClosing(state, sign > 0 ? 'long' : 'short');
        let remaining = Math.min(quantity, Math.abs(originalShares));
        let removedCost = 0;
        let removedQuantity = 0;
        lots.forEach((lot) => {
            if (remaining <= 1e-9) return;
            const lotQuantity = Math.abs(Number(lot.quantity) || 0);
            const matchedQuantity = Math.min(lotQuantity, remaining);
            if (matchedQuantity <= 1e-9) return;
            lot.quantity -= sign * matchedQuantity;
            removedQuantity += matchedQuantity;
            removedCost += Number(lot.unitPrice) * matchedQuantity;
            remaining -= matchedQuantity;
        });
        if (remaining > 1e-9) {
            const sharesAfterLots = originalShares - (sign * removedQuantity);
            const costAfterLots = originalTotalCost - removedCost;
            const fallbackQuantity = Math.min(Math.abs(sharesAfterLots), remaining);
            const fallbackAverage = Math.abs(sharesAfterLots) > 1e-9
                ? costAfterLots / Math.abs(sharesAfterLots)
                : 0;
            removedQuantity += fallbackQuantity;
            removedCost += fallbackAverage * fallbackQuantity;
        }
        state.shares = originalShares - (sign * removedQuantity);
        state.totalCost = Math.max(0, originalTotalCost - removedCost);
        state.lots = ensurePositionLots(state).filter((lot) => Math.abs(Number(lot.quantity) || 0) > 1e-9);
        return {removedQuantity, removedCost};
    }

    function removePositionLots(state, quantity, { basisOverride = null, useAverage = false } = {}) {
        if (!Number.isFinite(quantity) || quantity <= 0 || isFlatPosition(state.shares)) return 0;
        const originalTotalCost = Number(state.totalCost) || 0;
        const {removedQuantity} = consumePositionLots(state, quantity, {useAverage});
        if (basisOverride !== null && Number.isFinite(Number(basisOverride))) {
            const targetTotalCost = Math.max(0, originalTotalCost - Number(basisOverride));
            const remainingShares = Math.abs(Number(state.shares) || 0);
            const remainingLotCost = state.lots.reduce(
                (total, lot) => total + (Math.abs(Number(lot.quantity) || 0) * Number(lot.unitPrice) || 0),
                0,
            );
            const costAdjustmentPerShare = remainingShares > 1e-9
                ? (targetTotalCost - remainingLotCost) / remainingShares
                : 0;
            state.lots.forEach((lot) => {
                lot.unitPrice = Math.max(0, Number(lot.unitPrice) + costAdjustmentPerShare);
            });
            state.totalCost = targetTotalCost;
        }
        return removedQuantity;
    }

    function closePositionLots(state, quantity, unitPrice) {
        if (!Number.isFinite(quantity) || quantity <= 0 || isFlatPosition(state.shares)) return 0;

        const isLongPosition = state.shares > 0;
        const method = getInvestmentCostBasisMethod();
        state.lotMatchingMethod = method;
        const {removedQuantity, removedCost} = consumePositionLots(
            state,
            quantity,
            {useAverage: method === 'moving_average'},
        );
        const realizedDelta = isLongPosition
            ? (unitPrice * removedQuantity) - removedCost
            : removedCost - (unitPrice * removedQuantity);

        state.realizedPnl += realizedDelta;

        if (isFlatPosition(state.shares)) {
            resetPositionState(state);
        }
        return realizedDelta;
    }

    function applyDirectionalTrade(state, side, quantity, unitPrice) {
        if (!Number.isFinite(quantity) || quantity <= 0) return 0;

        if (isFlatPosition(state.shares)) {
            openPositionLots(state, side, quantity, unitPrice);
            return 0;
        }

        const currentSide = state.shares > 0 ? 'long' : 'short';
        if (currentSide === side) {
            openPositionLots(state, side, quantity, unitPrice);
            return 0;
        }

        const closingQuantity = Math.min(Math.abs(state.shares), quantity);
        const realizedDelta = closePositionLots(state, closingQuantity, unitPrice);

        const openingQuantity = quantity - closingQuantity;
        if (openingQuantity > 1e-9) {
            resetPositionState(state);
            openPositionLots(state, side, openingQuantity, unitPrice);
        }
        return realizedDelta;
    }

    function getMoneyMarketTickerSet() {
        const configuredTickers = globalThis.window?.ANTIGRAVITY_INVESTMENT_DATA?.money_market_tickers;
        const sourceTickers = Array.isArray(configuredTickers)
            ? configuredTickers
            : Object.keys(INVESTMENT_MONEY_MARKET_STANDARD_NAMES);
        const cashEquivalentTickers = globalThis.window?.ANTIGRAVITY_INVESTMENT_DATA?.cash_equivalent_tickers;
        return new Set(
            [
                ...sourceTickers,
                ...(Array.isArray(cashEquivalentTickers) ? cashEquivalentTickers : []),
            ]
                .map((ticker) => String(ticker || '').trim().toUpperCase())
                .filter(Boolean)
        );
    }

    function getCashEquivalentTickerSet() {
        let configuredTickers = window.ANTIGRAVITY_INVESTMENT_DATA?.cash_equivalent_tickers;
        if (!Array.isArray(configuredTickers)) {
            configuredTickers = window.ANTIGRAVITY_INVESTMENT_DATA?.money_market_tickers || [];
        }
        return new Set(
            (configuredTickers || [])
                .map((ticker) => String(ticker || '').trim().toUpperCase())
                .filter(Boolean)
        );
    }

    function getLatestDashboardEquity(processedTransactions, chartPoints = []) {
        const latestChartPoint = Array.isArray(chartPoints) && chartPoints.length
            ? chartPoints[chartPoints.length - 1]
            : null;
        const latestValuationEquity = Number(
            latestChartPoint?.aggregate_current_total_equity
            ?? latestChartPoint?.aggregate_total_equity
            ?? latestChartPoint?.total_equity,
        );
        if (Number.isFinite(latestValuationEquity)) {
            return latestValuationEquity;
        }

        const latestRecord = Array.isArray(processedTransactions) && processedTransactions.length
            ? processedTransactions[processedTransactions.length - 1]
            : null;
        const totalEquity = Number(latestRecord?.aggregate_total_equity ?? latestRecord?.total_equity);
        return Number.isFinite(totalEquity) ? totalEquity : 0;
    }

    function normalizeLedgerDate(value) {
        const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
        return match ? match[1] : '';
    }

    function buildHsbcCashSettlementBoundaryPlan(transactions = []) {
        const boundaries = [];
        (Array.isArray(transactions) ? transactions : []).forEach((txn, ownerTransactionIndex) => {
            const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
            const broker = String(txn?.broker || source.broker || '').trim().toLowerCase();
            const normalizedType = String(txn?.type || '').trim().toLowerCase();
            const transactionDate = normalizeLedgerDate(txn?.date);
            if (
                broker !== 'hsbc'
                || !['buy', 'sell'].includes(normalizedType)
                || !transactionDate
            ) return;

            const rawPostings = Array.isArray(source.cash_settlement_postings)
                ? source.cash_settlement_postings
                : [];
            const candidatePostings = rawPostings.length
                ? rawPostings
                : [{
                    date: source.cash_settlement_date,
                    amount_raw: source.cash_settlement_amount_raw,
                    balance_after_raw: source.cash_settlement_balance_after_raw,
                    reference: source.cash_settlement_reference,
                    row_number: source.cash_settlement_source_row_number,
                    ledger_sequence: source.cash_settlement_source_row_number,
                    currency: txn?.currency,
                    role: 'legacy_order_summary',
                }];

            candidatePostings.forEach((posting, postingIndex) => {
                const settlementDate = normalizeLedgerDate(posting?.date || source.cash_settlement_date);
                if (!settlementDate || settlementDate <= transactionDate) return;
                const settlementAmount = Number(posting?.amount_raw ?? posting?.amount);
                const settlementBalance = Number(posting?.balance_after_raw);
                if (!Number.isFinite(settlementAmount) && !Number.isFinite(settlementBalance)) return;
                const sourceRowSequence = Number(
                    posting?.ledger_sequence
                    ?? posting?.row_number
                    ?? source.cash_settlement_source_row_number
                    ?? 0,
                );
                const sourceRowNumber = Number(
                    posting?.row_number
                    ?? source.cash_settlement_source_row_number
                    ?? 0,
                );
                boundaries.push({
                    ownerTransactionIndex,
                    broker: txn?.broker || source.broker || 'hsbc',
                    account: txn?.account || source.account || source.account_number || '',
                    date: settlementDate,
                    currency: String(posting?.currency || txn?.currency || 'USD').trim().toUpperCase() || 'USD',
                    settlementAmount: Number.isFinite(settlementAmount) ? settlementAmount : null,
                    settlementBalanceAfter: Number.isFinite(settlementBalance) ? settlementBalance : null,
                    sourceRowSequence: Number.isFinite(sourceRowSequence) ? sourceRowSequence : 0,
                    sourceRowNumber: Number.isFinite(sourceRowNumber) ? sourceRowNumber : 0,
                    sourceFileKind: String(
                        posting?.source_file_kind || source.file_kind || '',
                    ).trim().toLowerCase(),
                    sourceIndex: ownerTransactionIndex,
                    postingIndex,
                    role: String(posting?.role || 'principal').trim() || 'principal',
                    reference: String(
                        posting?.reference
                        || source.cash_settlement_reference
                        || source.statement_order_id
                        || '',
                    ).trim(),
                });
            });
        });
        return boundaries.sort((left, right) => (
            left.date.localeCompare(right.date)
            || left.sourceRowSequence - right.sourceRowSequence
            || left.sourceRowNumber - right.sourceRowNumber
            || left.sourceIndex - right.sourceIndex
            || left.postingIndex - right.postingIndex
        ));
    }

    function parseInvestmentChartDate(value) {
        const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return null;
        const year = Number(match[1]);
        const monthIndex = Number(match[2]) - 1;
        const day = Number(match[3]);
        if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || !Number.isInteger(day)) return null;
        return new Date(Date.UTC(year, monthIndex, day));
    }

    function shiftLedgerDate(value, dayOffset) {
        const parsedDate = parseInvestmentChartDate(value);
        if (!(parsedDate instanceof Date) || Number.isNaN(parsedDate.getTime())) return '';
        const shiftedDate = new Date(parsedDate.getTime());
        shiftedDate.setUTCDate(shiftedDate.getUTCDate() + Number(dayOffset || 0));
        const year = shiftedDate.getUTCFullYear();
        const month = String(shiftedDate.getUTCMonth() + 1).padStart(2, '0');
        const day = String(shiftedDate.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function enumerateCalendarDateKeys(startValue, endValue) {
        const startDate = parseInvestmentChartDate(startValue);
        const endDate = parseInvestmentChartDate(endValue);
        if (
            !(startDate instanceof Date)
            || Number.isNaN(startDate.getTime())
            || !(endDate instanceof Date)
            || Number.isNaN(endDate.getTime())
            || startDate > endDate
        ) {
            return [];
        }
        const dates = [];
        for (
            let currentDate = new Date(startDate.getTime());
            currentDate <= endDate;
            currentDate.setUTCDate(currentDate.getUTCDate() + 1)
        ) {
            dates.push(currentDate.toISOString().slice(0, 10));
        }
        return dates;
    }

    function getInvestmentStockDetailsRangeLabels(labels, range = 'max', options = {}) {
        const orderedLabels = Array.isArray(labels)
            ? labels.map((value) => normalizeLedgerDate(value)).filter(Boolean)
            : [];
        if (!orderedLabels.length) return [];
        const normalizedRange = normalizeInvestmentStockDetailsRange(range);
        if (normalizedRange === 'max') return orderedLabels;

        const latestDate = parseInvestmentChartDate(orderedLabels[orderedLabels.length - 1]);
        if (!(latestDate instanceof Date) || Number.isNaN(latestDate.getTime())) {
            return orderedLabels;
        }

        if (normalizedRange === '3d') {
            return orderedLabels.slice(-Math.min(3, orderedLabels.length));
        }

        let startDate = null;
        let endDate = latestDate;
        if (normalizedRange === '1w') {
            startDate = new Date(latestDate.getTime());
            startDate.setUTCDate(startDate.getUTCDate() - 6);
        } else if (normalizedRange === '3m') {
            startDate = new Date(latestDate.getTime());
            startDate.setUTCMonth(startDate.getUTCMonth() - 3);
        } else if (normalizedRange === 'ytd') {
            startDate = new Date(Date.UTC(latestDate.getUTCFullYear(), 0, 1));
        } else if (normalizedRange === '1y') {
            startDate = new Date(latestDate.getTime());
            startDate.setUTCFullYear(startDate.getUTCFullYear() - 1);
        } else if (normalizedRange === 'auto') {
            const tradeDates = Array.isArray(options?.tradeDates)
                ? options.tradeDates.map((value) => normalizeLedgerDate(value)).filter(Boolean)
                : [];
            if (!tradeDates.length) return orderedLabels;
            const firstTradeDate = parseInvestmentChartDate(tradeDates[0]);
            const lastTradeDate = parseInvestmentChartDate(tradeDates[tradeDates.length - 1]);
            if (
                !(firstTradeDate instanceof Date)
                || Number.isNaN(firstTradeDate.getTime())
                || !(lastTradeDate instanceof Date)
                || Number.isNaN(lastTradeDate.getTime())
            ) {
                return orderedLabels;
            }
            startDate = new Date(firstTradeDate.getTime());
            startDate.setUTCDate(startDate.getUTCDate() - 7);
            if (options?.isOpenPosition === false) {
                endDate = new Date(lastTradeDate.getTime());
                endDate.setUTCDate(endDate.getUTCDate() + 7);
                if (endDate > latestDate) {
                    endDate = latestDate;
                }
            }
        }

        if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) {
            return orderedLabels;
        }

        const filteredLabels = orderedLabels.filter((label) => {
            const currentDate = parseInvestmentChartDate(label);
            return (
                currentDate instanceof Date
                && !Number.isNaN(currentDate.getTime())
                && currentDate >= startDate
                && currentDate <= endDate
            );
        });
        return filteredLabels.length ? filteredLabels : orderedLabels;
    }

    function getInvestmentEquityRangeLabels(labels, range = 'max') {
        const orderedLabels = Array.isArray(labels)
            ? labels.map((value) => normalizeLedgerDate(value)).filter(Boolean)
            : [];
        if (!orderedLabels.length) return [];
        const normalizedRange = normalizeInvestmentEquityRange(range);
        if (normalizedRange === 'max') return orderedLabels;

        const latestDate = parseInvestmentChartDate(orderedLabels[orderedLabels.length - 1]);
        if (!(latestDate instanceof Date) || Number.isNaN(latestDate.getTime())) {
            return orderedLabels;
        }

        let startDate = null;
        if (normalizedRange === '1w') {
            startDate = new Date(latestDate.getTime());
            startDate.setUTCDate(startDate.getUTCDate() - 6);
        } else if (normalizedRange === '1m') {
            startDate = new Date(latestDate.getTime());
            startDate.setUTCMonth(startDate.getUTCMonth() - 1);
        } else if (normalizedRange === '3m') {
            startDate = new Date(latestDate.getTime());
            startDate.setUTCMonth(startDate.getUTCMonth() - 3);
        } else if (normalizedRange === 'ytd') {
            startDate = new Date(Date.UTC(latestDate.getUTCFullYear(), 0, 1));
        } else if (normalizedRange === '1y') {
            startDate = new Date(latestDate.getTime());
            startDate.setUTCFullYear(startDate.getUTCFullYear() - 1);
        }

        if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) {
            return orderedLabels;
        }

        const filteredLabels = orderedLabels.filter((label) => {
            const currentDate = parseInvestmentChartDate(label);
            return currentDate instanceof Date && !Number.isNaN(currentDate.getTime()) && currentDate >= startDate;
        });
        return filteredLabels.length ? filteredLabels : orderedLabels;
    }

    function buildTickerPriceIndex(tickerClosePrices) {
        const priceIndex = {};
        Object.entries(tickerClosePrices || {}).forEach(([ticker, dateMap]) => {
            const dates = Object.keys(dateMap || {}).sort();
            priceIndex[ticker] = {
                dates,
                closes: { ...(dateMap || {}) },
            };
        });
        return priceIndex;
    }

    function normalizePriceHistoryPayload(priceHistoryByTicker) {
        const rawMaps = {};
        Object.entries(priceHistoryByTicker || {}).sort(([left], [right]) => left.localeCompare(right)).forEach(([ticker, rows]) => {
            const normalizedTicker = normalizeInvestmentTicker(ticker);
            if (!normalizedTicker || !Array.isArray(rows)) return;
            rawMaps[normalizedTicker] = rawMaps[normalizedTicker] || {};
            const candidatesByDate = {};
            rows.forEach((row) => {
                const date = normalizeLedgerDate(row?.date);
                const close = Number(row?.close);
                if (!date || !Number.isFinite(close) || close <= 0) return;
                if (!candidatesByDate[date]) candidatesByDate[date] = [];
                candidatesByDate[date].push({
                    close,
                    signature: JSON.stringify(row),
                });
            });
            Object.entries(candidatesByDate).forEach(([date, candidates]) => {
                candidates.sort((left, right) => (
                    left.signature.localeCompare(right.signature)
                    || left.close - right.close
                ));
                rawMaps[normalizedTicker][date] = candidates[0].close;
            });
        });
        const normalized = {};
        Object.entries(rawMaps).sort(([left], [right]) => left.localeCompare(right)).forEach(([ticker, dateMap]) => {
            normalized[ticker] = { ...(normalized[ticker] || {}), ...dateMap };
        });
        Object.entries(rawMaps).sort(([left], [right]) => left.localeCompare(right)).forEach(([ticker, dateMap]) => {
            if (INVESTMENT_LINEAGE_PROXY_TICKERS.has(ticker)) return;
            const canonicalTicker = getInvestmentCanonicalTicker(ticker);
            if (!canonicalTicker || canonicalTicker === ticker) return;
            normalized[canonicalTicker] = normalized[canonicalTicker] || {};
            Object.entries(dateMap || {}).sort(([left], [right]) => left.localeCompare(right)).forEach(([date, close]) => {
                if (normalized[canonicalTicker][date] === undefined) {
                    normalized[canonicalTicker][date] = close;
                }
            });
        });
        return normalized;
    }

    function getIndexedClosePriceOnOrBefore(priceEntry, targetDate) {
        if (!priceEntry || !targetDate) return null;
        const dates = Array.isArray(priceEntry.dates) ? priceEntry.dates : [];
        for (let index = dates.length - 1; index >= 0; index -= 1) {
            if (dates[index] <= targetDate) {
                const close = Number(priceEntry.closes?.[dates[index]]);
                if (Number.isFinite(close) && close > 0) return close;
            }
        }
        return null;
    }

    const INVESTMENT_TICKER_LINEAGE_FALLBACK = {
        'SPLG.US': ['SPYM', 'SPYM.US', 'SPLG', 'SPY', 'SPY.US'],
        SPLG: ['SPYM', 'SPYM.US', 'SPY', 'SPY.US'],
        'HK0000369196.USD': ['HK0000369196'],
        'HK0000369196.HK': ['HK0000369196'],
        'HK0000584752.HK': ['HK0000584752'],
        'HK0000584737.HK': ['HK0000584737'],
        'HK0000478872.HK': ['HK0000478872'],
        'HK0000720752.HK': ['HK0000720752'],
        'HK0001039582.USD': ['HK0001039582'],
        'HK0001039582.HK': ['HK0001039582'],
        'LONGBRIDGE_HK_CASH_EQUIVALENT.PING_AN_MONEY_MARKET_USD.USD': ['HK0000720752'],
        'LONGBRIDGE_HK_CASH_EQUIVALENT.GAOTENG_MONEY_MARKET_USD.USD': ['HK0000584737'],
        'LONGBRIDGE_HK_CASH_EQUIVALENT.GAOTENG_MONEY_MARKET_HKD.HKD': ['HK0000478872'],
    };

    function getInvestmentTickerLineageMap() {
        const payloadLineage = globalThis.window?.ANTIGRAVITY_INVESTMENT_DATA?.ticker_lineage;
        if (payloadLineage && typeof payloadLineage === 'object' && !Array.isArray(payloadLineage)) {
            return payloadLineage;
        }
        return INVESTMENT_TICKER_LINEAGE_FALLBACK;
    }

    function getInvestmentTickerStoreAliasCandidates(ticker) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (!normalizedTicker) return [];
        const candidates = [];
        const addCandidate = (value) => {
            const normalizedAlias = normalizeInvestmentTicker(value);
            if (normalizedAlias && !candidates.includes(normalizedAlias)) {
                candidates.push(normalizedAlias);
            }
        };
        const lineageMap = getInvestmentTickerLineageMap();
        (lineageMap[normalizedTicker] || []).forEach((alias) => {
            addCandidate(alias);
        });
        if (normalizedTicker.endsWith('.US')) {
            addCandidate(normalizedTicker.slice(0, -3).trim());
        }
        if (normalizedTicker.endsWith('.HK')) {
            const [symbol, suffix] = normalizedTicker.split('.');
            const strippedSymbol = String(symbol || '').replace(/^0+(?=\d)/, '');
            if (strippedSymbol && strippedSymbol !== symbol) {
                addCandidate(`${strippedSymbol}.${suffix}`);
            }
        }
        addCandidate(normalizedTicker);
        if (
            !normalizedTicker.endsWith('.US')
            && !normalizedTicker.endsWith('.HK')
            && /^[A-Z0-9]+$/.test(normalizedTicker)
        ) {
            addCandidate(`${normalizedTicker}.US`);
        }
        return candidates;
    }

    function getInvestmentCanonicalTicker(ticker) {
        const candidates = getInvestmentTickerStoreAliasCandidates(ticker);
        return candidates[0] || normalizeInvestmentTicker(ticker);
    }

    function getInvestmentLegacyLineageTickers(ticker) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (!normalizedTicker) return [];
        const lineageMap = getInvestmentTickerLineageMap();
        const proxyTickers = new Set(['SPY', 'SPY.US']);
        const legacyTickers = [];
        Object.entries(lineageMap).forEach(([legacyTicker, successors]) => {
            const identitySuccessors = (Array.isArray(successors) ? successors : [])
                .map((entry) => normalizeInvestmentTicker(entry))
                .filter((entry) => entry && !proxyTickers.has(entry));
            if (identitySuccessors.includes(normalizedTicker)) {
                const normalizedLegacyTicker = normalizeInvestmentTicker(legacyTicker);
                if (normalizedLegacyTicker && !legacyTickers.includes(normalizedLegacyTicker)) {
                    legacyTickers.push(normalizedLegacyTicker);
                }
            }
        });
        return legacyTickers;
    }

    function getInvestmentTickerProfileLookupCandidates(ticker) {
        const legacyLineageTickers = getInvestmentLegacyLineageTickers(ticker);
        const storeAliasCandidates = getInvestmentTickerStoreAliasCandidates(ticker);
        const candidates = [];
        const addCandidate = (value) => {
            const normalizedCandidate = normalizeInvestmentTicker(value);
            if (normalizedCandidate && !candidates.includes(normalizedCandidate)) {
                candidates.push(normalizedCandidate);
            }
        };
        legacyLineageTickers.forEach(addCandidate);
        storeAliasCandidates.forEach(addCandidate);
        return candidates;
    }

    function buildValuationStatus({
        backendFailures = [],
        fallbackTickers = [],
        missingTickers = [],
        openTickers = [],
    } = {}) {
        const normalizedBackendFailures = Array.isArray(backendFailures) ? backendFailures : [];
        const openTickerSet = new Set(
            (Array.isArray(openTickers) ? openTickers : [])
                .map((ticker) => normalizeInvestmentTicker(ticker))
                .filter(Boolean),
        );
        const isOpenTicker = (ticker) => openTickerSet.has(normalizeInvestmentTicker(ticker));
        const formatDisplayTicker = (ticker) => {
            const normalizedTicker = normalizeInvestmentTicker(ticker);
            return normalizedTicker.endsWith('.US') ? normalizedTicker.slice(0, -3) : normalizedTicker;
        };
        const normalizedFallbackTickers = Array.from(new Set((Array.isArray(fallbackTickers) ? fallbackTickers : [])
            .map((ticker) => normalizeInvestmentTicker(ticker))
            .filter((ticker) => !isForexPairTicker(ticker))
            .filter(Boolean)
            .filter((ticker) => isOpenTicker(ticker))));
        const normalizedMissingTickers = Array.from(new Set((Array.isArray(missingTickers) ? missingTickers : [])
            .map((ticker) => normalizeInvestmentTicker(ticker))
            .filter((ticker) => !isForexPairTicker(ticker))
            .filter(Boolean)
            .filter((ticker) => isOpenTicker(ticker))));
        const filteredBackendFailures = normalizedBackendFailures.filter((entry) => {
            const ticker = normalizeInvestmentTicker(entry?.ticker || '');
            if (ticker && isForexPairTicker(ticker)) return false;
            if (ticker && !isOpenTicker(ticker)) return false;
            return true;
        });
        const hasBackendFailures = filteredBackendFailures.length > 0;
        const isDegraded = hasBackendFailures || normalizedMissingTickers.length > 0;
        if (!isDegraded) {
            return {
                isDegraded: false,
                message: '',
                backendFailures: filteredBackendFailures,
                fallbackTickers: normalizedFallbackTickers,
                missingTickers: normalizedMissingTickers,
            };
        }

        const messageParts = [];
        if (normalizedMissingTickers.length) {
            messageParts.push(`Valuation is incomplete for ${normalizedMissingTickers.map((ticker) => formatDisplayTicker(ticker)).join(', ')} because no usable local close history was found.`);
        }
        if (hasBackendFailures) {
            messageParts.push(filteredBackendFailures.map((entry) => {
                const message = String(entry?.message || '');
                const ticker = normalizeInvestmentTicker(entry?.ticker || '');
                return ticker ? message.replaceAll(ticker, formatDisplayTicker(ticker)) : message;
            }).filter(Boolean).join(' '));
        }

        return {
            isDegraded: true,
            message: messageParts.filter(Boolean).join(' '),
            backendFailures: filteredBackendFailures,
            fallbackTickers: normalizedFallbackTickers,
            missingTickers: normalizedMissingTickers,
        };
    }

    function adjustTradePriceForRenderedSeries(transactionPrice, renderedSeriesPrice) {
        const rawTradePrice = Number(transactionPrice);
        const referencePrice = Number(renderedSeriesPrice);
        if (!Number.isFinite(rawTradePrice)) return null;
        if (!Number.isFinite(referencePrice) || referencePrice <= 0 || rawTradePrice <= 0) {
            return rawTradePrice;
        }
        const rawRatio = rawTradePrice / referencePrice;
        if (!Number.isFinite(rawRatio) || rawRatio <= 0) return rawTradePrice;
        const closeEnoughDistance = Math.log(1.35);
        const rawDistance = Math.abs(Math.log(rawRatio));
        if (rawDistance <= closeEnoughDistance) return rawTradePrice;

        const splitFactorCandidates = Array.from(new Set([
            ...investmentCommonSplitFactors,
            ...investmentCommonSplitFactors
                .filter((factor) => Number.isFinite(factor) && factor > 0 && factor !== 1)
                .map((factor) => 1 / factor),
        ])).sort((left, right) => left - right);

        let bestFactor = 1;
        let bestDistance = Number.POSITIVE_INFINITY;
        splitFactorCandidates.forEach((factor) => {
            if (!Number.isFinite(factor) || factor <= 0) return;
            const ratioDistance = Math.abs(Math.log(rawRatio / factor));
            if (ratioDistance < bestDistance) {
                bestDistance = ratioDistance;
                bestFactor = factor;
            }
        });

        const materiallyDifferentFactor = Math.abs(Math.log(bestFactor)) >= Math.log(1.5);
        const confidentlyMatchedFactor = bestDistance <= Math.log(1.12);
        const meaningfullyImproved = bestDistance + 0.08 < rawDistance;
        if (!materiallyDifferentFactor || !confidentlyMatchedFactor || !meaningfullyImproved) {
            return rawTradePrice;
        }

        const adjustedPrice = rawTradePrice / bestFactor;
        const adjustedRatio = adjustedPrice / referencePrice;
        if (!Number.isFinite(adjustedPrice) || adjustedPrice <= 0 || !Number.isFinite(adjustedRatio) || adjustedRatio <= 0) {
            return rawTradePrice;
        }
        return Math.abs(Math.log(adjustedRatio)) <= closeEnoughDistance ? adjustedPrice : rawTradePrice;
    }

    function calculateSnapshotMarketValue(
        snapshot,
        valuationDate,
        tickerPriceIndex,
        moneyMarketTickers,
        fxTimeline = null,
        baseCurrency = INVESTMENT_BASE_CURRENCY,
    ) {
        if (!snapshot || !valuationDate) {
            return {
                marketValue: 0,
                holdingsMarketValues: {},
                missingPriceTickers: [],
                degradedPriceTickers: [],
                isComplete: false,
            };
        }
        let marketValue = 0;
        const holdingsMarketValues = {};
        const missingPriceTickers = new Set();
        const degradedPriceTickers = new Set();

        Object.entries(snapshot.holdings || {}).forEach(([ticker, quantity]) => {
            const numericQuantity = Number(quantity);
            if (!Number.isFinite(numericQuantity) || Math.abs(numericQuantity) < 1e-9) return;

            let closePrice = getIndexedClosePriceOnOrBefore(tickerPriceIndex?.[ticker], valuationDate);
            const normalizedTicker = String(ticker).trim().toUpperCase();
            const isMoneyMarketTicker = (
                moneyMarketTickers.has(normalizedTicker)
                || isSyntheticCashEquivalentTicker(normalizedTicker)
            );

            if (isMoneyMarketTicker) {
                const anchoredPrice = snapshot.money_market_anchors?.[ticker] ?? snapshot.money_market_anchors?.[normalizedTicker];
                closePrice = anchoredPrice ?? closePrice;
            }

            if (!Number.isFinite(closePrice) || closePrice <= 0) {
                missingPriceTickers.add(normalizedTicker);
                return;
            }

            const holdingMarketValue = numericQuantity * closePrice;
            const quoteCurrency = getTickerQuoteCurrency(ticker);
            const holdingMarketValueBase = convertAmountToBaseCurrency(
                holdingMarketValue,
                quoteCurrency,
                valuationDate,
                fxTimeline,
                baseCurrency,
            );
            marketValue += holdingMarketValueBase;
            if (Math.abs(holdingMarketValueBase) > 1e-9) {
                holdingsMarketValues[ticker] = holdingMarketValueBase;
            }
        });

        return {
            marketValue,
            holdingsMarketValues,
            missingPriceTickers: Array.from(missingPriceTickers).sort(),
            degradedPriceTickers: Array.from(degradedPriceTickers).sort(),
            isComplete: missingPriceTickers.size === 0,
        };
    }

    function buildDailyEquityChartPoints(
        processedTransactions,
        tickerClosePrices,
        moneyMarketTickers,
        {includeCalendarDays = false, replaySnapshots = []} = {},
    ) {
        if (!Array.isArray(processedTransactions) || !processedTransactions.length) {
            return [];
        }

        // Chart replay is keyed by the ledger booking date.  Do not trust the
        // execution timestamp to establish day order: broker imports may carry
        // a later booking date with an earlier history timestamp.
        const canonicalTransactions = [...processedTransactions].sort(
            (left, right) => compareInvestmentTransactionsForReplay(left, right),
        );
        const chartTransactions = (
            Array.isArray(replaySnapshots) && replaySnapshots.length
                ? replaySnapshots
                : canonicalTransactions
        ).slice().sort(
            (left, right) => compareInvestmentReplaySnapshots(left, right),
        );
        const firstLedgerDate = normalizeLedgerDate(chartTransactions[0]?.date);
        if (!firstLedgerDate) return [];

        const tickerPriceIndex = buildTickerPriceIndex(tickerClosePrices);
        const baseCurrency = getInvestmentBaseCurrency();
        const fxTimeline = buildInvestmentFxRateTimeline(canonicalTransactions, baseCurrency);
        const tradingDateSet = new Set();
        Object.values(tickerPriceIndex).forEach((entry) => {
            (entry?.dates || []).forEach((date) => {
                if (date >= firstLedgerDate) {
                    tradingDateSet.add(date);
                }
            });
        });

        const ledgerDateMap = new Map();
        canonicalTransactions.forEach((txn) => {
            const ledgerDate = normalizeLedgerDate(txn?.date);
            if (!ledgerDate) return;
            if (!ledgerDateMap.has(ledgerDate)) {
                ledgerDateMap.set(ledgerDate, {
                    snapshot: txn,
                    ledgerNos: [],
                    cashInAmountBase: 0,
                    cashOutAmountBase: 0,
                    netTransferAmount: 0,
                    netTransferAmountsInBase: 0,
                });
            }
            const entry = ledgerDateMap.get(ledgerDate);
            entry.snapshot = txn;
            entry.ledgerNos.push(Number(txn.ledger_no || 0));
            const normalizedType = getNormalizedTransactionType(txn);
            const transactionAmount = Math.abs(Number(getTransactionAmount(txn)));
            const transactionCurrency = normalizeCurrencyCode(formatTransactionCurrency(txn)) || baseCurrency;
            const transactionAmountBase = convertAmountToBaseCurrency(
                transactionAmount,
                transactionCurrency,
                ledgerDate,
                fxTimeline,
                baseCurrency,
            );
            if (!Number.isFinite(transactionAmount) || transactionAmount <= 1e-9) return;
            if (
                txn?.manual_internal_transfer_external_flow_excluded === true
                || getInvestmentInternalTransferAggregateBridgeDelta(txn) !== 0
            ) return;
            if (isCashDepositType(normalizedType)) {
                entry.cashInAmountBase += transactionAmountBase;
                entry.netTransferAmount += transactionAmount;
                entry.netTransferAmountsInBase += transactionAmountBase;
            } else if (isCashWithdrawalType(normalizedType)) {
                entry.cashOutAmountBase += transactionAmountBase;
                entry.netTransferAmount -= transactionAmount;
                entry.netTransferAmountsInBase -= transactionAmountBase;
            }
        });

        const replayLedgerDates = chartTransactions
            .map((snapshot) => normalizeLedgerDate(snapshot?.date))
            .filter(Boolean);
        const observedCandidateDates = Array.from(new Set([
            ...Array.from(tradingDateSet),
            ...Array.from(ledgerDateMap.keys()),
            ...replayLedgerDates,
        ])).sort();
        const observedCandidateDateSet = new Set(observedCandidateDates);

        const points = [];
        let processedCursor = 0;
        let activeSnapshot = null;
        let cumulativeNetTransferAmount = 0;
        let previousTradingPointIndex = -1;
        const anchorDate = shiftLedgerDate(firstLedgerDate, -1);
        const candidateDates = includeCalendarDays && observedCandidateDates.length
            ? Array.from(new Set([
                ...observedCandidateDates,
                ...enumerateCalendarDateKeys(firstLedgerDate, observedCandidateDates[observedCandidateDates.length - 1]),
            ])).sort()
            : observedCandidateDates;
        const startingCash = getInvestmentStartingCash();

        if (anchorDate) {
            points.push({
                date: anchorDate,
                running_cash: startingCash,
                aggregate_running_cash: startingCash,
                market_value: 0,
                aggregate_market_value: 0,
                holdings_market_values: {},
                aggregate_holdings_market_values: {},
                total_equity: startingCash,
                aggregate_total_equity: startingCash,
                aggregate_current_display_cash: startingCash,
                aggregate_current_total_equity: startingCash,
                anchor_ledger_date: '',
                anchor_ledger_nos: [],
                cash_in_amount: 0,
                cash_out_amount: 0,
                net_transfer_amount: 0,
                cumulative_net_transfer_amount: 0,
                is_trading_day: false,
                previous_trading_point_index: -1,
            });
        }

        candidateDates.forEach((date) => {
            while (processedCursor < chartTransactions.length) {
                const nextSnapshot = chartTransactions[processedCursor];
                const nextLedgerDate = normalizeLedgerDate(nextSnapshot?.date);
                if (!nextLedgerDate || nextLedgerDate > date) break;
                activeSnapshot = nextSnapshot;
                processedCursor += 1;
            }

            if (!activeSnapshot) return;

            const aggregateSnapshot = {
                ...activeSnapshot,
                holdings: activeSnapshot?.aggregate_holdings || activeSnapshot?.holdings || {},
                money_market_anchors: activeSnapshot?.aggregate_money_market_anchors || activeSnapshot?.money_market_anchors || {},
            };
            const valuation = calculateSnapshotMarketValue(
                aggregateSnapshot,
                date,
                tickerPriceIndex,
                moneyMarketTickers,
                fxTimeline,
                baseCurrency,
            );
            const rawRunningCash = Number(
                activeSnapshot?.aggregate_running_cash
                ?? activeSnapshot?.running_cash,
            ) || 0;
            const aggregatePendingSettlementCash = Number(activeSnapshot?.aggregate_pending_settlement_cash) || 0;
            const currentRunningCash = rawRunningCash;
            const currentDisplayCash = Number(
                activeSnapshot?.aggregate_display_cash
                ?? currentRunningCash + aggregatePendingSettlementCash,
            );
            const isCurrentReplayBoundary = activeSnapshot === chartTransactions[chartTransactions.length - 1];
            const aggregateBridgeAdjustment = Number(activeSnapshot?.aggregate_bridge_adjustment) || 0;
            const historicalRunningCash = Number(activeSnapshot?.aggregate_history_running_cash);
            const aggregateRunningCash = Number(
                isCurrentReplayBoundary
                    ? currentRunningCash
                    : Number.isFinite(historicalRunningCash)
                        ? historicalRunningCash
                        : Number(activeSnapshot?.aggregate_running_cash ?? activeSnapshot?.running_cash) + aggregateBridgeAdjustment,
            ) || 0;
            const historicalDisplayCash = Number(activeSnapshot?.aggregate_history_display_cash);
            const rawAggregateDisplayCash = Number(
                isCurrentReplayBoundary
                    ? currentDisplayCash
                    : Number.isFinite(historicalDisplayCash)
                        ? historicalDisplayCash
                        : Number(activeSnapshot?.aggregate_display_cash) + aggregateBridgeAdjustment,
            );
            const aggregateDisplayCash = Number.isFinite(rawAggregateDisplayCash)
                ? rawAggregateDisplayCash
                : aggregateRunningCash + aggregatePendingSettlementCash;
            const aggregateMarketValue = valuation.marketValue;
            const aggregateTotalEquity = valuation.isComplete
                ? aggregateDisplayCash + aggregateMarketValue
                : null;
            const currentTotalEquity = valuation.isComplete
                ? currentDisplayCash + aggregateMarketValue
                : null;
            const ledgerEntry = ledgerDateMap.get(date);
            const isCalendarCarryForward = includeCalendarDays && !observedCandidateDateSet.has(date);
            const anchorLedgerNos = Array.isArray(ledgerEntry?.ledgerNos)
                ? ledgerEntry.ledgerNos.filter((ledgerNo) => Number.isFinite(ledgerNo) && ledgerNo > 0)
                : [];
            const cashInAmount = Number(ledgerEntry?.cashInAmountBase) || 0;
            const cashOutAmount = Number(ledgerEntry?.cashOutAmountBase) || 0;
            const netTransferAmount = (Number(ledgerEntry?.netTransferAmountsInBase) || 0);
            const isTradingDay = tradingDateSet.has(date);
            cumulativeNetTransferAmount += netTransferAmount;

            points.push({
                date,
                running_cash: aggregateRunningCash,
                aggregate_running_cash: aggregateRunningCash,
                aggregate_display_cash: aggregateDisplayCash,
                aggregate_current_display_cash: currentDisplayCash,
                market_value: valuation.isComplete ? aggregateMarketValue : null,
                aggregate_market_value: valuation.isComplete ? aggregateMarketValue : null,
                holdings_market_values: valuation.holdingsMarketValues,
                aggregate_holdings_market_values: valuation.holdingsMarketValues,
                total_equity: aggregateTotalEquity,
                aggregate_total_equity: aggregateTotalEquity,
                aggregate_current_total_equity: currentTotalEquity,
                valuation_complete: valuation.isComplete,
                missing_price_tickers: valuation.missingPriceTickers,
                degraded_price_tickers: valuation.degradedPriceTickers,
                anchor_ledger_date: anchorLedgerNos.length ? date : '',
                anchor_ledger_nos: anchorLedgerNos,
                cash_in_amount: cashInAmount,
                cash_out_amount: cashOutAmount,
                net_transfer_amount: netTransferAmount,
                cumulative_net_transfer_amount: cumulativeNetTransferAmount,
                is_trading_day: isTradingDay,
                is_calendar_carry_forward: isCalendarCarryForward,
                previous_trading_point_index: previousTradingPointIndex,
            });
            if (isTradingDay) {
                previousTradingPointIndex = points.length - 1;
            }
        });

        return points;
    }

    function buildTickerSummaries(transactions, latestPrices, totalEquity, tickerClosePrices = {}) {
        const tickerMap = new Map();
        const lotScopeMap = new Map();
        const orderedTransactions = [...transactions].sort((left, right) => (
            compareInvestmentTaxLotTransactions(left, right)
        ));
        const tickerPriceIndex = buildTickerPriceIndex(tickerClosePrices);
        const renderedSplitFactorHints = buildRenderedSplitFactorHints(orderedTransactions, tickerPriceIndex);
        const baseCurrency = getInvestmentBaseCurrency();
        const fxTimeline = buildInvestmentFxRateTimeline(orderedTransactions, baseCurrency);
        const authoritativePositionSnapshot = getAuthoritativePositionSnapshotForTransactions(orderedTransactions);
        const authoritativePerformanceSnapshot = getAuthoritativePerformanceSnapshot();
        const authoritativeBrokerPerformanceSnapshots = getAuthoritativeBrokerPerformanceSnapshots();
        const verifiedTaxLotHistoryScopes = getVerifiedTaxLotHistoryScopes();
        const useAuthoritativePositionSnapshot = authoritativePositionSnapshot !== null;
        const canonicalAuthoritativePositionSnapshot = {};
        if (useAuthoritativePositionSnapshot) {
            Object.entries(authoritativePositionSnapshot).forEach(([ticker, snapshot]) => {
                const canonicalTicker = getInvestmentCanonicalTicker(ticker);
                if (!canonicalTicker) return;
                const quantity = getAuthoritativeSnapshotFiniteNumber(snapshot?.quantity) ?? 0;
                const costBasisStatus = snapshot?.costBasisStatus === 'known'
                    || snapshot?.costBasisStatus === 'partial'
                    ? snapshot.costBasisStatus
                    : 'unknown';
                const costPrice = costBasisStatus === 'known'
                    ? getAuthoritativeSnapshotFiniteNumber(snapshot?.costPrice)
                    : null;
                const marketValue = getAuthoritativeSnapshotFiniteNumber(snapshot?.marketValue);
                const lastPrice = getAuthoritativeSnapshotFiniteNumber(snapshot?.lastPrice);
                const previous = canonicalAuthoritativePositionSnapshot[canonicalTicker];
                if (!previous) {
                    canonicalAuthoritativePositionSnapshot[canonicalTicker] = {
                        ...snapshot,
                        quantity,
                        costBasisStatus,
                        costPrice,
                    };
                    return;
                }
                const previousQuantity = Number(previous.quantity) || 0;
                const nextQuantity = previousQuantity + quantity;
                const nextCostBasisStatus = combineAuthoritativeCostBasisStatus(
                    previous.costBasisStatus,
                    costBasisStatus,
                );
                previous.quantity = nextQuantity;
                if (
                    nextCostBasisStatus === 'known'
                    && Number.isFinite(previous.costPrice)
                    && Number.isFinite(costPrice)
                ) {
                    const previousCostTotal = Math.abs(previousQuantity) * previous.costPrice;
                    const nextCostTotal = Math.abs(quantity) * costPrice;
                    previous.costBasisStatus = 'known';
                    previous.costPrice = Math.abs(nextQuantity) > 1e-9
                        ? (previousCostTotal + nextCostTotal) / Math.abs(nextQuantity)
                        : costPrice;
                } else {
                    previous.costBasisStatus = nextCostBasisStatus === 'known'
                        ? 'unknown'
                        : nextCostBasisStatus;
                    previous.costPrice = null;
                }
                if (Number.isFinite(marketValue)) {
                    previous.marketValue = (Number(previous.marketValue) || 0) + marketValue;
                }
                if (Number.isFinite(lastPrice) && lastPrice > 0) {
                    previous.lastPrice = lastPrice;
                }
            });
        }

        orderedTransactions.forEach((txn) => {
            const syntheticCashEquivalentTicker = getLongbridgeHkCashEquivalentSyntheticTicker(txn);
            const ticker = syntheticCashEquivalentTicker
                ? getInvestmentCanonicalTicker(syntheticCashEquivalentTicker)
                : (
                shouldTrackHoldingTicker(txn)
                    ? getInvestmentCanonicalTicker(txn.ticker)
                    : ''
                );
            if (!ticker) return;
            const normalizedType = getNormalizedTransactionType(txn);
            const quantity = getTransactionValuationQuantity(txn, tickerPriceIndex, renderedSplitFactorHints);
            const amount = getTransactionAmount(txn);

            const ledgerDate = normalizeLedgerDate(txn?.date);

            const lotScopeKey = getTransactionLotScopeKey(txn, ticker);
            if (!lotScopeMap.has(lotScopeKey)) {
                const scopedState = createPositionState(ticker);
                scopedState.lotScope = getTransactionLotScope(txn, ticker);
                lotScopeMap.set(lotScopeKey, scopedState);
            }
            const scopedState = lotScopeMap.get(lotScopeKey);
            const scopedVerification = verifiedTaxLotHistoryScopes.get([
                scopedState.lotScope.broker,
                scopedState.lotScope.accountToken,
                scopedState.lotScope.ticker,
                scopedState.lotScope.currency,
            ].join('|')) ?? null;
            const scopedRealizedPnlBeforeTransaction = Number(scopedState.realizedPnl) || 0;
            if (syntheticCashEquivalentTicker) {
                const valueAfter = Number(
                    txn?.normalized?.cash_equivalent_value_after
                    ?? txn?.source?.cash_equivalent_cost_basis_after_raw
                    ?? 0
                );
                const interestAmount = Number(
                    txn?.normalized?.cash_equivalent_interest_amount
                    ?? txn?.source?.cash_equivalent_interest_raw
                    ?? 0
                );
                scopedState.shares = Number.isFinite(valueAfter) ? Math.max(0, valueAfter) : 0;
                scopedState.totalCost = scopedState.shares;
                if (Number.isFinite(interestAmount)) {
                    scopedState.realizedPnl += interestAmount;
                }
                if (isFlatPosition(scopedState.shares)) {
                    scopedState.lastCloseDate = ledgerDate;
                }
            } else {
                applyInvestmentTransactionToState(
                    scopedState,
                    txn,
                    normalizedType,
                    quantity,
                    amount,
                    ledgerDate,
                    {
                        preferBrokerRealizedPnl: true,
                        preferTradePriceAndCommission: (
                            scopedVerification?.calculationMethod === 'trade_price_and_commission'
                        ),
                    },
                );
            }
            const scopedRealizedPnlDelta = (
                Number(scopedState.realizedPnl) || 0
            ) - scopedRealizedPnlBeforeTransaction;
            if (ledgerDate && Math.abs(scopedRealizedPnlDelta) > 1e-9) {
                scopedState.realizedPnlByDate[ledgerDate] = (
                    Number(scopedState.realizedPnlByDate[ledgerDate]) || 0
                ) + scopedRealizedPnlDelta;
            }
        });

        getDynamicallyVerifiedTaxLotHistoryScopes(lotScopeMap).forEach((verification, key) => {
            if (!verifiedTaxLotHistoryScopes.has(key)) {
                verifiedTaxLotHistoryScopes.set(key, verification);
            }
        });

        // Position quantities, cost basis, and realized P&L are aggregated only
        // from the same broker/account/currency scopes that generated them.
        const scopedStatesByTicker = new Map();
        lotScopeMap.forEach((scopeState, lotScopeKey) => {
            const ticker = scopeState.lotScope?.ticker || scopeState.ticker;
            if (!ticker) return;
            if (!scopedStatesByTicker.has(ticker)) scopedStatesByTicker.set(ticker, new Map());
            scopedStatesByTicker.get(ticker).set(lotScopeKey, scopeState);
        });
        const scopedPositionAggregatesByTicker = new Map();
        scopedStatesByTicker.forEach((scopedStates, ticker) => {
            scopedPositionAggregatesByTicker.set(
                ticker,
                aggregateInvestmentScopedPositionStates(
                    scopedStates,
                    ticker,
                    getTickerQuoteCurrency,
                ),
            );
        });
        scopedPositionAggregatesByTicker.forEach((aggregate, ticker) => {
            if (!tickerMap.has(ticker)) tickerMap.set(ticker, createPositionState(ticker));
            const summary = tickerMap.get(ticker);
            summary.shares = aggregate.shares;
            summary.totalCost = aggregate.totalCost;
            summary.realizedPnl = aggregate.realizedPnl;
            summary.nonPerformanceRealizedPnl = aggregate.nonPerformanceRealizedPnl;
            summary.buyCount = aggregate.buyCount;
            summary.buyQuantity = aggregate.buyQuantity;
            summary.sellCount = aggregate.sellCount;
            summary.sellQuantity = aggregate.sellQuantity;
            summary.brokerRealizedSellCount = aggregate.brokerRealizedSellCount;
            summary.realizedPnlStatus = aggregate.realizedPnlStatus;
            summary.hasPartialTaxLotHistory = aggregate.hasPartialTaxLotHistory;
            summary.costBasisStatus = aggregate.costBasisStatus;
            summary.costBasisMethod = aggregate.costBasisMethod;
            summary.realizedPnlByDate = aggregate.realizedPnlByDate;
            summary.lastTradeDate = aggregate.lastTradeDate;
            summary.lastCloseDate = aggregate.lastCloseDate;
            summary.positionCurrencies = aggregate.positionCurrencies;
            summary.hasMixedPositionCurrencies = aggregate.hasMixedPositionCurrencies;
            summary.lotMatchingMethod = getInvestmentCostBasisMethod();
            summary.lots = [];
        });

        const realizedAccountResultsByTicker = new Map();
        lotScopeMap.forEach((scopeState) => {
            const scope = scopeState.lotScope;
            const authoritativeSnapshot = authoritativeBrokerPerformanceSnapshots.find((entry) => (
                entry.broker === scope.broker
                && entry.accountToken === scope.accountToken
            ));
            const performanceEntry = authoritativeSnapshot?.performanceSnapshot?.[scope.ticker] ?? null;
            const taxLotHistoryVerification = verifiedTaxLotHistoryScopes.get([
                scope.broker,
                scope.accountToken,
                scope.ticker,
                scope.currency,
            ].join('|')) ?? null;
            const verifiedTaxLotHistory = matchesVerifiedTaxLotHistory(
                scopeState,
                taxLotHistoryVerification,
            );
            const nonPerformanceRealizedPnlLocal = Number(scopeState.nonPerformanceRealizedPnl) || 0;
            let realizedPnlLocal = Number(scopeState.realizedPnl) || 0;
            let status = 'complete';
            let source = scopeState.brokerRealizedSellCount > 0
                ? 'broker_closed_trades'
                : 'account_tax_lot_reconstruction';
            let sourceCurrency = scope.currency;

            if (performanceEntry && Number.isFinite(performanceEntry.realizedTotal)) {
                realizedPnlLocal = performanceEntry.realizedTotal + (
                    performanceEntry.includesNonperformance ? 0 : nonPerformanceRealizedPnlLocal
                );
                sourceCurrency = performanceEntry.currency;
                source = 'broker_performance_snapshot';
            } else if (scopeState.realizedPnlStatus === 'incomplete') {
                status = 'incomplete';
                realizedPnlLocal = null;
                source = 'unavailable';
            } else if (
                scopeState.sellCount > scopeState.brokerRealizedSellCount
                && scopeState.hasPartialTaxLotHistory
                && !verifiedTaxLotHistory
            ) {
                status = 'unverified';
                realizedPnlLocal = null;
                source = 'unavailable';
            }

            const realizedPnl = realizedPnlLocal === null
                ? null
                : convertAmountToBaseCurrencyAtLatestRate(
                    realizedPnlLocal,
                    sourceCurrency,
                    fxTimeline,
                    baseCurrency,
                );
            const accountResult = {
                ...scope,
                realizedPnl: realizedPnl === null ? null : Number(realizedPnl.toFixed(12)),
                realizedPnlLocal: realizedPnlLocal === null
                    ? null
                    : Number(realizedPnlLocal.toFixed(12)),
                status,
                source,
                realizedPnlByDateLocal: (
                    status === 'complete' && source !== 'broker_performance_snapshot'
                ) ? {...scopeState.realizedPnlByDate} : {},
                sellCount: scopeState.sellCount,
                brokerRealizedSellCount: scopeState.brokerRealizedSellCount,
                taxLotHistoryVerification: verifiedTaxLotHistory
                    ? {...taxLotHistoryVerification}
                    : null,
            };
            if (!realizedAccountResultsByTicker.has(scope.ticker)) {
                realizedAccountResultsByTicker.set(scope.ticker, []);
            }
            realizedAccountResultsByTicker.get(scope.ticker).push(accountResult);
        });

        if (useAuthoritativePositionSnapshot) {
            Object.keys(canonicalAuthoritativePositionSnapshot).forEach((ticker) => {
                if (!tickerMap.has(ticker)) {
                    tickerMap.set(ticker, createPositionState(ticker));
                }
            });
        }

        return Array.from(tickerMap.values()).map((summary) => {
            const snapshotEntry = useAuthoritativePositionSnapshot
                ? canonicalAuthoritativePositionSnapshot[summary.ticker] ?? null
                : null;
            const shares = useAuthoritativePositionSnapshot
                ? Number(snapshotEntry?.quantity) || 0
                : summary.shares;
            const hasReconstructedCostBasis = (
                summary.costBasisMethod === 'FIFO reconstructed'
                && summary.costBasisStatus === 'known'
                && Number.isFinite(Number(summary.totalCost))
            );
            const costBasisStatus = snapshotEntry?.costBasisStatus === 'known'
                || snapshotEntry?.costBasisStatus === 'partial'
                ? snapshotEntry.costBasisStatus
                : (snapshotEntry ? (hasReconstructedCostBasis ? 'known' : 'unknown') : summary.costBasisStatus);
            const snapshotCostPrice = costBasisStatus === 'known'
                ? getAuthoritativeSnapshotFiniteNumber(snapshotEntry?.costPrice)
                : null;
            const performanceEntry = authoritativePerformanceSnapshot?.[summary.ticker] ?? null;
            const realizedPnlAccounts = realizedAccountResultsByTicker.get(summary.ticker) || [];
            const hasAuthoritativeBrokerRealizedPnl = realizedPnlAccounts.some((result) => (
                result.source === 'broker_performance_snapshot'
                && result.realizedPnl !== null
            ));
            const hasMixedPositionCurrencies = !snapshotEntry && summary.hasMixedPositionCurrencies === true;
            const preserveMixedCurrencyRealizedBreakdown = hasMixedPositionCurrencies;
            const costBasisUnavailable = hasMixedPositionCurrencies;
            const pnlUnavailable = (
                hasMixedPositionCurrencies && !hasAuthoritativeBrokerRealizedPnl
            )
                || (Boolean(snapshotEntry) && costBasisStatus !== 'known');
            const pnlUnavailableReason = !pnlUnavailable
                ? null
                : (hasMixedPositionCurrencies && !hasAuthoritativeBrokerRealizedPnl
                    ? 'multiple_position_currencies'
                    : (costBasisStatus === 'partial'
                        ? 'authoritative_position_snapshot_cost_basis_partial'
                        : 'authoritative_position_snapshot_cost_basis_unknown'));
            const costBasisUnavailableReason = costBasisUnavailable
                ? 'multiple_position_currencies'
                : null;
            const totalCost = useAuthoritativePositionSnapshot && snapshotEntry
                ? (snapshotCostPrice === null
                    ? (hasReconstructedCostBasis ? Number(summary.totalCost) : null)
                    : Math.abs(shares) * snapshotCostPrice)
                : (hasMixedPositionCurrencies ? null : summary.totalCost);
            const hasOpenPosition = !isFlatPosition(shares);
            const averagePrice = hasOpenPosition
                ? (snapshotEntry && snapshotCostPrice !== null
                    ? snapshotCostPrice
                    : (totalCost === null ? null : (totalCost / Math.abs(shares))))
                : null;
            const marketValueFromSnapshot = snapshotEntry && Number.isFinite(snapshotEntry.marketValue)
                ? snapshotEntry.marketValue
                : null;
            const snapshotLastPrice = snapshotEntry && Number.isFinite(snapshotEntry.lastPrice)
                ? snapshotEntry.lastPrice
                : null;
            const computedLastPrice = isSyntheticCashEquivalentTicker(summary.ticker)
                ? 1
                : (latestPrices[summary.ticker] ?? null);
            const lastPrice = snapshotLastPrice !== null
                ? snapshotLastPrice
                : (computedLastPrice !== null
                    ? computedLastPrice
                    : (marketValueFromSnapshot !== null && Math.abs(shares) > 1e-9
                        ? marketValueFromSnapshot / shares
                        : null));
            const quoteCurrency = getTickerQuoteCurrency(summary.ticker);
            const lastLedgerDate = normalizeLedgerDate(orderedTransactions[orderedTransactions.length - 1]?.date || '');
            const completeRealizedPnlAccounts = realizedPnlAccounts.filter((result) => result.realizedPnl !== null);
            const hasOnlyUnavailableRealizedAccounts = (
                realizedPnlAccounts.length > 0 && completeRealizedPnlAccounts.length === 0
            );
            let realizedPnlLocal = hasOnlyUnavailableRealizedAccounts
                ? null
                : completeRealizedPnlAccounts.reduce(
                    (total, result) => total + (Number(result.realizedPnlLocal) || 0),
                    0,
                );
            const nonPerformanceRealizedPnlLocal = Number(summary.nonPerformanceRealizedPnl) || 0;
            let realizedPnl = hasOnlyUnavailableRealizedAccounts
                ? null
                : completeRealizedPnlAccounts.reduce(
                    (total, result) => total + (Number(result.realizedPnl) || 0),
                    0,
                );
            if (realizedPnlLocal !== null) realizedPnlLocal = Number(realizedPnlLocal.toFixed(12));
            if (realizedPnl !== null) realizedPnl = Number(realizedPnl.toFixed(12));
            const usedLegacyTickerPerformanceSnapshot = (
                realizedPnlAccounts.length <= 1
                && performanceEntry
                && Number.isFinite(performanceEntry.realizedTotal)
            );
            if (usedLegacyTickerPerformanceSnapshot) {
                const additionalNonPerformanceRealizedPnlLocal = performanceEntry.includesNonperformance
                    ? 0
                    : nonPerformanceRealizedPnlLocal;
                realizedPnlLocal = performanceEntry.realizedTotal + additionalNonPerformanceRealizedPnlLocal;
                realizedPnl = (
                    convertAmountToBaseCurrencyAtLatestRate(
                        performanceEntry.realizedTotal,
                        performanceEntry.currency,
                        fxTimeline,
                        baseCurrency,
                    )
                    + convertAmountToBaseCurrencyAtLatestRate(
                        additionalNonPerformanceRealizedPnlLocal,
                        quoteCurrency,
                        fxTimeline,
                        baseCurrency,
                    )
                );
            }
            const marketValueLocal = hasMixedPositionCurrencies
                ? null
                : (hasOpenPosition
                ? (marketValueFromSnapshot !== null
                    ? marketValueFromSnapshot
                    : (lastPrice !== null ? shares * lastPrice : 0))
                : 0);
            const marketValue = marketValueLocal === null
                ? null
                : convertAmountToBaseCurrency(
                    marketValueLocal,
                    quoteCurrency,
                    lastLedgerDate,
                    fxTimeline,
                    baseCurrency,
                );
            const unrealizedPnlLocal = hasOpenPosition && lastPrice !== null && averagePrice !== null
                ? (shares > 0
                    ? (lastPrice - averagePrice) * shares
                    : (averagePrice - lastPrice) * Math.abs(shares))
                : null;
            const unrealizedPnl = unrealizedPnlLocal === null
                ? null
                : convertAmountToBaseCurrency(
                    unrealizedPnlLocal,
                    quoteCurrency,
                    lastLedgerDate,
                    fxTimeline,
                    baseCurrency,
                );
            const scopedRealizedPnlByDateLocal = usedLegacyTickerPerformanceSnapshot
                ? {}
                : completeRealizedPnlAccounts.reduce((dailyTotals, result) => {
                    Object.entries(result.realizedPnlByDateLocal || {}).forEach(([ledgerDate, value]) => {
                        dailyTotals[ledgerDate] = (Number(dailyTotals[ledgerDate]) || 0) + (Number(value) || 0);
                    });
                    return dailyTotals;
                }, {});
            const realizedPnlByDateLocal = pnlUnavailable
                ? {}
                : Object.fromEntries(
                    Object.entries(scopedRealizedPnlByDateLocal).map(([ledgerDate, value]) => ([
                        ledgerDate,
                        Number(Number(value).toFixed(12)),
                    ])),
                );
            const realizedPnlByDate = pnlUnavailable
                ? {}
                : Object.fromEntries(
                    Object.entries(realizedPnlByDateLocal).map(([ledgerDate, dailyRealizedPnlLocal]) => ([
                        ledgerDate,
                        convertAmountToBaseCurrency(
                            dailyRealizedPnlLocal,
                            quoteCurrency,
                            ledgerDate,
                            fxTimeline,
                            baseCurrency,
                        ),
                    ])),
                );
            const safeRealizedPnl = pnlUnavailable ? null : realizedPnl;
            const safeRealizedPnlLocal = pnlUnavailable ? null : realizedPnlLocal;
            const safeUnrealizedPnl = pnlUnavailable ? null : unrealizedPnl;
            const safeUnrealizedPnlLocal = pnlUnavailable ? null : unrealizedPnlLocal;
            // Mixed-currency rows cannot expose one combined P&L, but each
            // account result has already been converted from its own currency
            // into the workspace base currency and remains useful evidence.
            const safeRealizedPnlAccounts = pnlUnavailable && !preserveMixedCurrencyRealizedBreakdown
                ? realizedPnlAccounts.map((accountResult) => ({
                    ...accountResult,
                    realizedPnl: null,
                    realizedPnlLocal: null,
                    realizedPnlByDateLocal: {},
                    status: 'unavailable',
                    source: 'unavailable',
                }))
                : realizedPnlAccounts;
            const totalPnl = pnlUnavailable || safeRealizedPnl === null || costBasisUnavailable
                ? null
                : Number((safeRealizedPnl + (safeUnrealizedPnl ?? 0)).toFixed(12));
            const totalPnlLocal = pnlUnavailable || safeRealizedPnlLocal === null || costBasisUnavailable
                ? null
                : Number((safeRealizedPnlLocal + (safeUnrealizedPnlLocal ?? 0)).toFixed(12));
            const positionWeight = Number.isFinite(totalEquity)
                && Number.isFinite(marketValue)
                && Math.abs(totalEquity) > 1e-9
                && hasOpenPosition
                ? (marketValue / totalEquity) * 100
                : null;

            return {
                ...summary,
                shares,
                totalCost,
                averagePrice,
                costBasisStatus,
                costBasisMethod: summary.costBasisMethod,
                lotMatchingMethod: summary.lotMatchingMethod || getInvestmentCostBasisMethod(),
                lastPrice,
                marketValue,
                realizedPnl: safeRealizedPnl,
                realizedPnlLocal: safeRealizedPnlLocal,
                realizedPnlAccounts: safeRealizedPnlAccounts,
                realizedPnlStatus: pnlUnavailable && !preserveMixedCurrencyRealizedBreakdown
                    ? 'unavailable'
                    : (realizedPnlAccounts.some((result) => result.status !== 'complete')
                        ? 'partial'
                        : 'complete'),
                realizedPnlBreakdownAvailable: preserveMixedCurrencyRealizedBreakdown
                    && realizedPnlAccounts.some((result) => result.realizedPnl !== null),
                realizedPnlByDate,
                realizedPnlByDateLocal,
                quoteCurrency,
                unrealizedPnl: safeUnrealizedPnl,
                unrealizedPnlLocal: safeUnrealizedPnlLocal,
                unrealizedPnlStatus: pnlUnavailable
                    ? 'unavailable'
                    : (safeUnrealizedPnl === null ? 'unavailable' : 'complete'),
                totalPnl,
                totalPnlLocal,
                pnlUnavailable,
                pnlUnavailableReason,
                costBasisUnavailable,
                costBasisUnavailableReason,
                positionWeight,
                hasOpenPosition,
            };
        }).sort((left, right) => {
            if (left.hasOpenPosition !== right.hasOpenPosition) {
                return left.hasOpenPosition ? -1 : 1;
            }
            if (left.hasOpenPosition && right.hasOpenPosition) {
                return Math.abs(right.marketValue) - Math.abs(left.marketValue);
            }
            // Closed positions: sort by close time descending (most recent 清仓 first),
            // matching the requested top-to-bottom order (newest exit at top).
            const leftDate = left.lastCloseDate || '';
            const rightDate = right.lastCloseDate || '';
            if (leftDate !== rightDate) {
                return rightDate.localeCompare(leftDate);
            }
            return left.ticker.localeCompare(right.ticker);
        });
    }

    function formatAmount(value) {
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
    }

    return {
        adjustTradePriceForRenderedSeries,
        applyDirectionalTrade,
        applyInvestmentTransactionToState,
        buildDailyEquityChartPoints,
        buildInvestmentFxRateTimeline,
        buildRenderedSplitFactorHints,
        buildTickerPriceIndex,
        buildTickerSummaries,
        buildValuationStatus,
        aggregateInvestmentScopedPositionStates,
        getInvestmentCanonicalTicker,
        getInvestmentLegacyLineageTickers,
        getInvestmentTickerProfileLookupCandidates,
        getInvestmentTickerStoreAliasCandidates,
        cloneCashLedgerBalances,
        convertAmountToBaseCurrency,
        convertAmountToBaseCurrencyAtLatestRate,
        createCashLedger,
        createCashLedgerFromBalances,
        compareInvestmentTransactions,
        compareInvestmentTransactionsForReplay,
        getInvestmentReplayIdentity,
        buildHsbcCashSettlementBoundaryPlan,
        compareInvestmentTaxLotTransactions,
        calculateSnapshotMarketValue,
        closePositionLots,
        createPositionState,
        escapeHtml,
        formatAmountWithCurrency,
        formatForexTradeComponentDescription,
        formatHoldingsMoney,
        formatHoldingsPercent,
        formatHoldingsPosition,
        formatHoldingsUsd,
        formatSignedHoldingsMoney,
        formatTransactionCommissionDisplay,
        formatTransactionCurrency,
        formatTransactionDateDisplay,
        formatTransactionDescription,
        getIndexedClosePriceOnOrBefore,
        getInvestmentEquityRangeLabels,
        getInvestmentBrokerEndingCash,
        getInvestmentBrokerEndingCashBalances,
        getInvestmentBrokerStartingCash,
        getInvestmentBrokerStartingCashBalances,
        getInvestmentBrokerEndingCashInBaseCurrency,
        getInvestmentBrokerEndingCashAsOf,
        getInvestmentEndingCash,
        getInvestmentEndingCashBalances,
        getInvestmentEndingCashInBaseCurrency,
        getInvestmentEndingCashInBaseCurrencyAsOf,
        getAuthoritativePerformanceSnapshot,
        getAuthoritativeBrokerPerformanceSnapshots,
        getInvestmentStartingCash,
        getInvestmentStartingCashBalances,
        getInvestmentStockDetailsRangeLabels,
        getLatestDashboardEquity,
        getAuthoritativePositionSnapshot,
        getAuthoritativeBrokerPositionSnapshots,
        getAuthoritativePositionSnapshotForTransactions,
        getFxRateForDate,
        getLatestFxRateForCurrency,
        getInvestmentBaseCurrency,
        getInvestmentCostBasisMethod,
        getTodayLedgerDate,
        getMoneyMarketTickerSet,
        getCashEquivalentTickerSet,
        isSyntheticCashEquivalentTicker,
        isLongbridgeHkCashEquivalentTransfer,
        getLongbridgeHkCashEquivalentSyntheticTicker,
        isUsmartHkFractionalSharesTransaction,
        getNormalizedTransactionType,
        getTransactionAmount,
        getInvestmentInternalTransferAggregateBridgeAmount,
        getInvestmentInternalTransferAggregateBridgeDelta,
        getTransactionCommission,
        getTransactionEconomicAmount,
        getTransactionEffectiveUnitPrice,
        getTransactionBrokerRealizedPnl,
        getTransactionLotScope,
        getTransactionLotScopeKey,
        getTransactionRenderedSplitFactor,
        getTransactionValuationQuantity,
        getTransactionPrice,
        getTransactionQuantity,
        isFlatPosition,
        isForexPairTicker,
        getTickerQuoteCurrency,
        normalizeLedgerDate,
        normalizePriceHistoryPayload,
        parseInvestmentChartDate,
        resetPositionState,
        shiftLedgerDate,
        shouldTrackHoldingTicker,
        sumCashLedgerInBaseCurrency,
        sumKolRewardRealizedIncomeInBaseCurrency,
        isKolRewardTransaction,
        addCashLedgerDelta,
        USMART_HK_FRACTIONAL_SYNTHETIC_TICKER,
        LONGBRIDGE_HK_CASH_EQUIVALENT_SYNTHETIC_PREFIX,
    };
}

export const INVESTMENT_DATA_UTILS_MODULE_VERSION = 'v1.90.0';
