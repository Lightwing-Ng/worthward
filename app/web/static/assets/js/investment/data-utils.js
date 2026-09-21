/**
 * Investment transaction and valuation helpers.
 *
 * Code version: v1.117.0
 * - Fixed: HSBC realized trade proceeds include an evidenced settlement fee
 *   posting once without changing the principal cash row or balance boundary.
 * - Fixed: Current Holdings NAV adds a dated broker interest accrual exactly
 *   once through the shared current-equity calculation and fails closed when
 *   that accrual cannot be converted into the workspace base currency.
 * - Fixed: Daily equity materializes accrual-only statement boundaries and
 *   treats missing dated FX as unavailable equity rather than zero accrual.
 * - Added: Dated broker interest-accrual NAV boundaries are applied to
 *   broker and aggregate equity only on their statement as-of date.
 * - Fixed: Same-day buy/sell pairs keep their account-local execution order
 *   when other brokers have rows at the same timestamp.
 * - Fixed: Current broker cash snapshots include ledger cash movements
 *   recorded after the snapshot boundary, such as a later withdrawal.
 * - Fixed: Same-day HSBC settlement boundaries recover their chronological
 *   order from authoritative balance continuity when incremental paste row
 *   sequences drift across imports.
 * - Fixed: Missing dividend-reinvestment basis remains unknown instead of
 *   opening a fabricated zero-cost lot for P&L.
 * - Fixed: Partial account-level realized-P&L coverage now withholds every
 *   ticker-level P&L total while retaining the account evidence.
 * - Added: Optional numeric parsing preserves null and blank values instead
 *   of coercing them to zero.
 * - Fixed: IBKR forex components show the acquired base currency and paid
 *   quote currency instead of reversing the fill direction.
 * - Fixed: Dividend-reinvestment shares carry their reinvestment cost basis, and
 *   unknown open-position basis now fails P&L closed instead of fabricating zero cost.
 * - Fixed: Post-snapshot income belongs only to incremental realized P&L,
 *   preventing dividends and withholding from also entering the baseline.
 * - Fixed: Complete file history can reconstruct an omitted IBKR position boundary.
 * - Fixed: Missing FX propagates an unknown valuation instead of currency parity.
 * - Added: Aggregate P&L coverage distinguishes complete, partial, and unavailable.
 * - Added: Broker-scoped realized-P&L reconciliation now carries coverage,
 *   independent as-of dates, replay state, and the snapshot-plus-increment
 *   invariant consumed by every Investment surface.
 * - Fixed: An IBKR current-position snapshot marked as partial history can
 *   still supplement a dated realized-P&L snapshot when the omitted ticker's
 *   position quantity is fully reconstructed from the scoped transaction
 *   history; ambiguous or incoherent histories remain unavailable.
 * - Fixed: Schwab date-only same-day trades now keep the persisted execution
 *   sequence during browser replay instead of falling back to cash ordering.
 * - Changed: Linked Schwab dividend and withholding rows now display their
 *   canonical ticker while retaining the raw broker description as evidence.
 * - Changed: HSBC buy and sell descriptions now show one compact P-/S- order
 *   reference, with a trailing * only while settlement evidence is unresolved.
 * - Changed: Dividend and foreign-tax descriptions now use the transaction's
 *   canonical ticker instead of source-provided security names or identifiers.
 * - Changed: Foreign-currency FX conversion no longer makes a current HSBC
 *   cash display provisional. The leading * now identifies only unresolved
 *   HSBC settlement cash, such as a fee that posts on the following day.
 * - Added: One broker-current-cash resolver now converts every native-currency
 *   balance, applies pending settlement once, and reports provisional display
 *   state for both aggregate and broker-scoped surfaces.
 * - Fixed: Broker position snapshots with a rounded same-day as-of time can
 *   accept the first same-day replay state that exactly matches the
 *   authoritative quantity, while genuine quantity mismatches remain blocked.
 * - Added: Current broker cash aggregation can use the broker's authoritative
 *   display boundary, including HSBC pending-settlement adjustments, without
 *   confusing it with the raw replay balance.
 * - Added: Current Holdings equity can be derived from one cash snapshot and
 *   the market value of every open holding, with fail-closed handling for
 *   missing valuation inputs.
 * - Fixed: A validated HSBC snapshot can now attest a fully covered ticker
 *   that is absent from the open-position list when replay proves the position
 *   is flat, so closed round trips contribute realized P&L without trusting an
 *   incomplete history.
 * - Fixed: Tax-lot replay now compares normalized transaction datetimes before
 *   falling back to raw source timestamp text, so mixed IBKR display formats
 *   cannot place a current fill before older history.
 * - Fixed: Cost-method resolution now skips an invalid API value and uses the
 *   valid server-rendered setting instead of silently falling back to the
 *   default method.
 * - Changed: Browser compatibility no longer synthesizes broker/account-specific
 *   tax-lot evidence when a stale backend payload omits verification metadata.
 * - Added: Authoritative cash snapshots can retain an intraday as-of datetime
 *   for same-day replay boundaries.
 * - Fixed: Exact-time cash boundaries no longer rewrite earlier transactions
 *   from the same calendar day.
 * - Fixed: Once the frontend has established a bound-transfer replay order,
 *   later history, chart, and Metrics sorting cannot fall back to broker
 *   timestamps or source row numbers and reverse the source-before-receipt
 *   constraint.
 * - Fixed: A newer authoritative HSBC position snapshot can supersede an
 *   older verified tax-lot boundary after an incremental Order Status import.
 * - Fixed: IBKR cash replay uses the last available transaction date when a
 *   statement cash snapshot is reported one day after the last trade.
 * - Fixed: Stock-grant rows, including IBKR grants, always open zero-cost
 *   lots. An evidenced per-share grant value remains source evidence and
 *   cannot become a purchase cost basis.
 * - Fixed: Broker realized-P&L snapshots now replay later evidenced trades
 *   from a FIFO transaction-history inventory, instead of treating a stale
 *   aggregate position cost as the supplemental fill's average cost. An old
 *   file snapshot can no longer change the tax-lot method of a pasted fill.
 * - Fixed: A newer position snapshot no longer suppresses trades that occurred
 *   after an older broker realized-P&L snapshot. Position validation and
 *   realized-P&L supplementation now use their own authoritative as-of dates
 *   from the canonical broker snapshot instead of stale presentation metadata.
 * - Fixed: Supplemental broker realized P&L now uses the same scoped
 *   configured lot-matching result as transaction rows. FIFO remains an
 *   inventory-boundary verifier and cannot make summary and row P&L diverge.
 * - Added: Historical Overview Tooltip P&L can replay a point without applying
 *   a current broker position or performance snapshot. The caller supplies the
 *   point valuation date and observed close, so historical P&L cannot inherit
 *   today's holdings or broker calibration.
 * - Fixed: Money-market classification no longer absorbs configured
 *   cash-equivalent securities. Money-market funds remain cash equivalents,
 *   while ETFs such as SGOV and BOXX retain their own quotes and identities.
 * - Fixed: A stale backend process can no longer hide the exact user-verified
 *   HSBC DRAM and EUV tax-lot attestations from a refreshed browser. The
 *   client compatibility fallback is account-scoped and remains fail-closed
 *   against the verified date, trade counts, quantities, and ending shares.
 * - Added: HSBC settlement boundaries retain their source transaction date so
 *   trade-date accruals and settlement-date clearing remain independently
 *   auditable.
 * - Fixed: Explicit tax-lot attestations can verify an open position by its
 *   exact ending-share quantity, restoring HSBC DRAM and EUV realized P&L
 *   without weakening the fail-closed rule for unmatched histories.
 * - Fixed: Authoritative cash and position snapshots are dated replay anchors,
 *   so later trades remain reflected in current cash, holdings, and equity.
 * - Added: Cash and position snapshots expose independent as-of dates; stale
 *   cash metadata can no longer stand in for a holdings boundary.
 * - Fixed: Date-only HSBC Order Status executions now retain their evidenced
 *   newest-first page rank for same-day trade and tax-lot replay. SEC cash
 *   posting order remains isolated to cash settlement boundaries and cannot
 *   reverse a buy and sell or manufacture a transient short position.
 * - Fixed: Daily equity replay now preserves reverse-split share factors, so
 *   a split-only closing-price series and imported pre-split quantities remain
 *   in the same valuation basis.
 * - Fixed: Every HSBC cash balance boundary now clears stale unscoped replay
 *   cash in its currency before account-type balances are aggregated.
 * - Fixed: HSBC cash statement balances now remain scoped by broker, account,
 *   account type, and currency before they are aggregated into workspace cash.
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
 * - Changed: HSBC same-day history sorts funding cash rows ahead of trade
 *   executions, while date-only executions retain their source-page sequence.
 * - Added: Stock details range filtering now supports a 1Y window plus an Auto lifecycle mode that keeps all buy and sell dates visible while trimming unrelated post-exit history
 * - Added: Equity range filtering now supports a 1Y window for the main portfolio overview chart
 */

import {
    createInvestmentCoreCashUtils,
} from './data-utils/core-cash.js?v=investment-data-utils-core-cash-v1.1.0';
import {
    createInvestmentInterestAccrualUtils,
} from './data-utils/interest-accruals.js?v=investment-data-utils-interest-accruals-v1.0.0';
import {
    createInvestmentPositionValuationUtils,
} from './data-utils/position-valuation.js?v=investment-data-utils-position-valuation-v1.0.0';
import {
    createInvestmentReconciliationUtils,
} from './data-utils/reconciliation.js?v=investment-data-utils-reconciliation-v1.1.0';
import {
    createInvestmentSummaryUtils,
} from './data-utils/summaries.js?v=investment-data-utils-summaries-v1.2.0';
import {
    createInvestmentTransactionPresentationUtils,
} from './data-utils/transaction-presentation.js?v=investment-data-utils-transaction-presentation-v1.1.0';

export const INVESTMENT_REPLAY_ORDER_SYMBOL = Symbol('investmentReplayOrder');

export function parseInvestmentOptionalNumber(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

const INVESTMENT_COST_BASIS_METHODS = new Set([
    'lowest_cost_first',
    'fifo',
    'lifo',
    'moving_average',
]);

export function normalizeInvestmentCostBasisMethod(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return INVESTMENT_COST_BASIS_METHODS.has(normalized)
        ? normalized
        : 'lowest_cost_first';
}

export function getInvestmentCostBasisMethod() {
    const configuredValues = [
        globalThis.window?.WORTHWARD_INVESTMENT_DATA?.investment_cost_basis_method,
        globalThis.window?.WORTHWARD_APP?.investmentCostBasisMethod,
    ];
    for (const value of configuredValues) {
        const normalized = String(value || '').trim().toLowerCase();
        if (INVESTMENT_COST_BASIS_METHODS.has(normalized)) return normalized;
    }
    return normalizeInvestmentCostBasisMethod(null);
}

export function applyInvestmentVerifiedTaxLotCompatibilityFallbacks(payload) {
    // Compatibility data must come from the current payload. Never synthesize
    // broker/account-specific tax-lot evidence in the browser.
    return [];
}

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

function hasHsbcCashSettlementEvidence(source) {
    if (!source || typeof source !== 'object') return false;
    const hasFiniteValue = (value) => {
        const normalized = String(value ?? '').trim().replace(/,/g, '');
        return normalized !== '' && Number.isFinite(Number(normalized));
    };
    if (
        hasFiniteValue(source.cash_settlement_amount_raw)
        || hasFiniteValue(source.cash_settlement_balance_after_raw)
    ) {
        return true;
    }
    return Array.isArray(source.cash_settlement_postings)
        && source.cash_settlement_postings.some((posting) => (
            posting
            && typeof posting === 'object'
            && (
                hasFiniteValue(posting.amount_raw ?? posting.amount)
                || hasFiniteValue(posting.balance_after_raw)
            )
        ));
}

export function isHsbcSettlementActuallyPending(source) {
    return source?.cash_replay_pending_settlement === true
        && !hasHsbcCashSettlementEvidence(source);
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
        if (!isFlatScopedPosition(state.shares)) {
            if (state.costBasisStatus === 'unknown') {
                aggregate.costBasisStatus = 'unknown';
            } else if (
                state.costBasisStatus === 'partial'
                && aggregate.costBasisStatus === 'known'
            ) {
                aggregate.costBasisStatus = 'partial';
            }
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
    const hasUnknownOpenCostBasis = hasOpenPosition && aggregate.costBasisStatus !== 'known';
    const averagePrice = (
        hasMixedPositionCurrencies
        || hasUnknownOpenCostBasis
        || !Number.isFinite(aggregate.shares)
        || !hasOpenPosition
    ) ? null : aggregate.totalCost / Math.abs(aggregate.shares);

    return {
        ...aggregate,
        totalCost: hasMixedPositionCurrencies || hasUnknownOpenCostBasis ? null : aggregate.totalCost,
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
    const runtime = {
        INVESTMENT_REPLAY_ORDER_SYMBOL,
        aggregateInvestmentScopedPositionStates,
        formatInvestmentShortDateParts,
        getInvestmentCostBasisMethod,
        investmentCommonSplitFactors,
        isHsbcSettlementActuallyPending,
        noCommissionTransactionTypes,
        normalizeInvestmentEquityRange,
        normalizeInvestmentStockDetailsRange,
        normalizeInvestmentTicker,
        parseInvestmentDateParts,
    };
    Object.assign(runtime, createInvestmentCoreCashUtils(runtime));
    Object.assign(runtime, createInvestmentInterestAccrualUtils(runtime));
    Object.assign(runtime, createInvestmentTransactionPresentationUtils(runtime));
    Object.assign(runtime, createInvestmentReconciliationUtils(runtime));
    Object.assign(runtime, createInvestmentPositionValuationUtils(runtime));
    Object.assign(runtime, createInvestmentSummaryUtils(runtime));
    const {
        adjustTradePriceForRenderedSeries,
        applyDirectionalTrade,
        applyInvestmentInterestAccrualBoundaries,
        applyInvestmentTransactionToState,
        buildDailyEquityChartPoints,
        buildInvestmentFxRateTimeline,
        buildRenderedSplitFactorHints,
        buildTickerPriceIndex,
        buildTickerSummaries,
        buildValuationStatus,
        getInvestmentCanonicalTicker,
        getInvestmentLegacyLineageTickers,
        getInvestmentTickerProfileLookupCandidates,
        getInvestmentTickerStoreAliasCandidates,
        cloneCashLedgerBalances,
        createInvestmentCashScopeLedger,
        convertAmountToBaseCurrency,
        convertAmountToBaseCurrencyAtLatestRate,
        createCashLedger,
        createCashLedgerFromBalances,
        compareInvestmentTransactions,
        compareInvestmentTransactionsForReplay,
        getInvestmentReplayIdentity,
        buildHsbcCashSettlementBoundaryPlan,
        getInvestmentCashBalanceBoundary,
        getInvestmentCashBalanceScope,
        getInvestmentCashScopeBalances,
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
        getInvestmentBrokerCurrentPendingSettlementCash,
        getInvestmentBrokerCurrentDisplayCash,
        getInvestmentBrokerCurrentCashSnapshot,
        getInvestmentInterestAccrualOnDate,
        buildInvestmentPostSnapshotCashDelta,
        getInvestmentBrokerEndingCashAsOf,
        getInvestmentBrokerEndingCashAsOfDateTime,
        getInvestmentBrokerPositionSnapshotAsOf,
        getInvestmentEndingCash,
        getInvestmentEndingCashBalances,
        getInvestmentEndingCashInBaseCurrency,
        getInvestmentEndingCashInBaseCurrencyAsOf,
        getInvestmentPositionSnapshotAsOf,
        buildDatedCashSnapshotProjection,
        getAuthoritativePerformanceSnapshot,
        getAuthoritativeBrokerPerformanceSnapshots,
        getInvestmentStartingCash,
        getInvestmentStartingCashBalances,
        getInvestmentStockDetailsRangeLabels,
        getLatestDashboardEquity,
        computeInvestmentLiveHoldingsTotalEquity,
        getAuthoritativePositionSnapshot,
        getAuthoritativeBrokerPositionSnapshots,
        getAuthoritativePositionSnapshotForTransactions,
        projectAuthoritativePositionSnapshot,
        getFxRateForDate,
        getLatestFxRateForCurrency,
        getInvestmentBaseCurrency,
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
        getTransactionEvidencedTradeCashAmount,
        getTransactionEvidencedTradePrincipalAmount,
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
        addInvestmentCashScopeDelta,
        setInvestmentCashScopeAggregateBalance,
        setInvestmentCashScopeBoundary,
        USMART_HK_FRACTIONAL_SYNTHETIC_TICKER,
        LONGBRIDGE_HK_CASH_EQUIVALENT_SYNTHETIC_PREFIX,
    } = runtime;

    function computeInvestmentCurrentHoldingsTotalEquity(
        summaries,
        aggregateCash,
        interestAccrual = null,
    ) {
        const baseTotalEquity = computeInvestmentLiveHoldingsTotalEquity(summaries, aggregateCash);
        if (!Number.isFinite(baseTotalEquity)) return null;
        if (interestAccrual === null || interestAccrual === undefined) return baseTotalEquity;
        const interestAccrualAmount = Number(interestAccrual?.amount);
        return Number.isFinite(interestAccrualAmount)
            ? baseTotalEquity + interestAccrualAmount
            : null;
    }

    return {
        adjustTradePriceForRenderedSeries,
        applyDirectionalTrade,
        applyInvestmentInterestAccrualBoundaries,
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
        createInvestmentCashScopeLedger,
        convertAmountToBaseCurrency,
        convertAmountToBaseCurrencyAtLatestRate,
        createCashLedger,
        createCashLedgerFromBalances,
        compareInvestmentTransactions,
        compareInvestmentTransactionsForReplay,
        getInvestmentReplayIdentity,
        buildHsbcCashSettlementBoundaryPlan,
        getInvestmentCashBalanceBoundary,
        getInvestmentCashBalanceScope,
        getInvestmentCashScopeBalances,
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
        getInvestmentBrokerCurrentPendingSettlementCash,
        getInvestmentBrokerCurrentDisplayCash,
        getInvestmentBrokerCurrentCashSnapshot,
        getInvestmentInterestAccrualOnDate,
        buildInvestmentPostSnapshotCashDelta,
        getInvestmentBrokerEndingCashAsOf,
        getInvestmentBrokerEndingCashAsOfDateTime,
        getInvestmentBrokerPositionSnapshotAsOf,
        getInvestmentEndingCash,
        getInvestmentEndingCashBalances,
        getInvestmentEndingCashInBaseCurrency,
        getInvestmentEndingCashInBaseCurrencyAsOf,
        getInvestmentPositionSnapshotAsOf,
        buildDatedCashSnapshotProjection,
        getAuthoritativePerformanceSnapshot,
        getAuthoritativeBrokerPerformanceSnapshots,
        getInvestmentStartingCash,
        getInvestmentStartingCashBalances,
        getInvestmentStockDetailsRangeLabels,
        getLatestDashboardEquity,
        computeInvestmentLiveHoldingsTotalEquity,
        computeInvestmentCurrentHoldingsTotalEquity,
        getAuthoritativePositionSnapshot,
        getAuthoritativeBrokerPositionSnapshots,
        getAuthoritativePositionSnapshotForTransactions,
        projectAuthoritativePositionSnapshot,
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
        getTransactionEvidencedTradeCashAmount,
        getTransactionEvidencedTradePrincipalAmount,
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
        addInvestmentCashScopeDelta,
        setInvestmentCashScopeAggregateBalance,
        setInvestmentCashScopeBoundary,
        USMART_HK_FRACTIONAL_SYNTHETIC_TICKER,
        LONGBRIDGE_HK_CASH_EQUIVALENT_SYNTHETIC_PREFIX,
    };
}

export const INVESTMENT_DATA_UTILS_MODULE_VERSION = 'v1.117.0';

// Coverage is independent of the numeric subtotal; unknown components never count as zero.
export function getInvestmentAggregatePnlCoverage(summaries = []) {
    const rows = Array.isArray(summaries) ? summaries : [];
    const missing = rows.filter((summary) => (
        summary?.pnlUnavailable === true
        || (summary?.realizedPnlStatus && summary.realizedPnlStatus !== 'complete')
        || !Number.isFinite(summary?.realizedPnl)
        || (summary?.hasOpenPosition && !Number.isFinite(summary?.unrealizedPnl))
    ));
    return {
        status: missing.length === 0
            ? 'complete'
            : (missing.length < rows.length || rows.some((summary) => summary?.realizedPnlStatus === 'partial')
                ? 'partial'
                : 'unavailable'),
        completeCount: rows.length - missing.length,
        totalCount: rows.length,
        missingTickers: missing.map((summary) => summary?.ticker).filter(Boolean),
    };
}
