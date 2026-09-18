/**
 * Realtime session, quote, and chart synchronization.
 *
 * Code version: v1.1.0
 * - Changed: Binding response now applies broker_summaries to refresh
 *   the authoritative cash snapshot without requiring a full page reload.
 */

export function createInvestmentRealtimeChartRuntime(runtime) {
function normalizeInvestmentView(value) {
        const normalized = String(value || '').trim().toLowerCase();
        return runtime.INVESTMENT_VIEW_ORDER.includes(normalized) ? normalized : 'chart';
    }

function stopInvestmentRealtimeQuotePolling() {
        runtime.investmentRealtimeQuotePoller.stop();
    }

function getInvestmentRealtimeQuoteEndpoint() {
        return window.WORTHWARD_APP?.endpoints?.investmentRealtimeQuotes || '/api/investment/realtime-quotes';
    }

function getInvestmentMarketSessionEndpoint() {
        return window.WORTHWARD_APP?.endpoints?.investmentMarketSession || '/api/market-session/us-equity';
    }

function getSafeInvestmentMarketSessionState() {
        return (runtime.state.investmentMarketSessionState && typeof runtime.state.investmentMarketSessionState === 'object') ? runtime.state.investmentMarketSessionState : null;
    }

function isInvestmentOverviewHighPrecisionEquityRange(range = runtime.state.selectedInvestmentEquityRange) {
        const normalizedRange = runtime.normalizeInvestmentEquityRange(range);
        return normalizedRange === '1w' || normalizedRange === '1m';
    }

function getInvestmentOverviewIntradayDayCount(range = runtime.state.selectedInvestmentEquityRange) {
        const normalizedRange = runtime.normalizeInvestmentEquityRange(range);
        return runtime.INVESTMENT_OVERVIEW_INTRADAY_DAY_COUNTS[normalizedRange] || 0;
    }

function refreshInvestmentMarketSessionState({
        force = false,
        dayCount = runtime.INVESTMENT_OVERVIEW_INTRADAY_DAY_COUNTS['1w'],
    } = {}) {
        const now = Date.now();
        const requestedDayCount = Math.max(1, Math.min(365, Number(dayCount) || runtime.INVESTMENT_OVERVIEW_INTRADAY_DAY_COUNTS['1w']));
        const isFresh = now - runtime.state.investmentMarketSessionStateLoadedAt <= runtime.INVESTMENT_MARKET_SESSION_TTL_MS;
        if (!force && isFresh && runtime.state.investmentMarketSessionStateRequest === null && runtime.state.investmentMarketSessionStateDayCount >= requestedDayCount) {
            return Promise.resolve(runtime.state.investmentMarketSessionState);
        }
        if (runtime.state.investmentMarketSessionStateRequest && runtime.state.investmentMarketSessionStateRequestDayCount === requestedDayCount) {
            return runtime.state.investmentMarketSessionStateRequest;
        }
        const sessionEndpoint = getInvestmentMarketSessionEndpoint();
        const resolvedEndpoint = `${sessionEndpoint}?day_count=${encodeURIComponent(String(requestedDayCount))}`;

        runtime.state.investmentMarketSessionStateRequest = (async () => {
            try {
                const response = await fetch(resolvedEndpoint, runtime.buildInvestmentRequestOptions());
                const payload = await response.json().catch(() => ({}));
                if (!response.ok || !payload?.success) {
                    throw new Error(payload?.error || 'Unable to read US equity market session state.');
                }
                const safePayload = (payload && typeof payload === 'object') ? payload : {};
                runtime.state.investmentMarketSessionState = {
                    market: String(safePayload.market || '').trim() || 'us_equity',
                    session: String(safePayload.session || '').trim().toLowerCase() || 'off',
                    is_trading_day: Boolean(safePayload.is_trading_day),
                    is_early_close: Boolean(safePayload.is_early_close),
                    is_realtime_allowed: Boolean(safePayload.is_realtime_allowed),
                    session_date: String(safePayload.session_date || '').trim(),
                    as_of: String(safePayload.as_of || '').trim(),
                    trading_days: Array.isArray(safePayload.trading_days)
                        ? [...new Set(safePayload.trading_days)]
                            .map((dayKey) => runtime.normalizeLedgerDate(dayKey))
                            .filter(Boolean)
                        : [],
                };
                runtime.state.investmentMarketSessionStateDayCount = requestedDayCount;
            } catch (error) {
                if (!isFresh || !runtime.state.investmentMarketSessionState) {
                    runtime.state.investmentMarketSessionState = {
                        market: 'us_equity',
                        session: 'off',
                        is_trading_day: false,
                        is_early_close: false,
                        is_realtime_allowed: false,
                        session_date: '',
                        as_of: '',
                        trading_days: [],
                    };
                }
                if (isFresh) {
                    console.warn('Unable to refresh US equity session state', error);
                }
            } finally {
                runtime.state.investmentMarketSessionStateLoadedAt = Date.now();
                runtime.state.investmentMarketSessionStateRequest = null;
                runtime.state.investmentMarketSessionStateRequestDayCount = 0;
            }
            runtime.syncInvestmentHoldingsLiveBadgeVisibility();
            return runtime.state.investmentMarketSessionState;
        })();
        runtime.state.investmentMarketSessionStateRequestDayCount = requestedDayCount;
        return runtime.state.investmentMarketSessionStateRequest;
    }

function getCachedInvestmentMarketSessionState() {
        const now = Date.now();
        const isFresh = now - runtime.state.investmentMarketSessionStateLoadedAt <= runtime.INVESTMENT_MARKET_SESSION_TTL_MS;
        if (!isFresh) {
            void refreshInvestmentMarketSessionState();
        }
        return getSafeInvestmentMarketSessionState();
    }

function shouldShowInvestmentRealtimePulse(session) {
        return ['overnight', 'pre', 'intraday', 'post'].includes(String(session || '').trim().toLowerCase());
    }

function getInvestmentNewYorkClockParts(date = new Date()) {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(date).reduce((nextParts, part) => {
            nextParts[part.type] = part.value;
            return nextParts;
        }, {});
        return {
            dateKey: `${parts.year || ''}-${parts.month || ''}-${parts.day || ''}`,
            weekday: String(parts.weekday || ''),
            hour: Number(parts.hour),
            minute: Number(parts.minute),
        };
    }

function getInvestmentRealtimeClockSession(date = new Date()) {
        return runtime.classifyInvestmentUsRealtimeSession(getInvestmentNewYorkClockParts(date));
    }

function shouldRunInvestmentRealtimeQuotes() {
        const usSessionState = getCachedInvestmentMarketSessionState();
        if (usSessionState?.is_realtime_allowed) {
            return true;
        }
        if (usSessionState && usSessionState.session !== 'off' && usSessionState.session !== 'post') {
            return false;
        }
        return (
            shouldShowInvestmentRealtimePulse(getInvestmentHongKongClockSession())
            && portfolioHasOpenHongKongHoldings()
        );
    }

function isInvestmentOverviewIntradayEquityRange(range = runtime.state.selectedInvestmentEquityRange) {
        return isInvestmentOverviewHighPrecisionEquityRange(range);
    }

function isInvestmentDailyEquityLiveRange(range = runtime.state.selectedInvestmentEquityRange) {
        return !isInvestmentOverviewIntradayEquityRange(range);
    }

function getInvestmentLiveSessionDateKey() {
        const sessionState = getCachedInvestmentMarketSessionState();
        if (sessionState?.is_realtime_allowed) {
            return sessionState.session_date || getInvestmentNewYorkClockParts().dateKey;
        }
        if (
            shouldShowInvestmentRealtimePulse(getInvestmentHongKongClockSession())
            && portfolioHasOpenHongKongHoldings()
        ) {
            return getInvestmentHongKongClockParts().dateKey;
        }
        return '';
    }

function getInvestmentDailyEquityLiveSessionDateKey() {
        return isInvestmentDailyEquityLiveRange()
            ? getInvestmentLiveSessionDateKey()
            : '';
    }

function findInvestmentChartPointIndexForLedgerDate(chartPoints = [], ledgerDate = '') {
        const normalizedLedgerDate = runtime.normalizeLedgerDate(ledgerDate);
        if (!normalizedLedgerDate || !Array.isArray(chartPoints)) return -1;
        for (let index = chartPoints.length - 1; index >= 0; index -= 1) {
            if (runtime.normalizeLedgerDate(chartPoints[index]?.date) === normalizedLedgerDate) {
                return index;
            }
        }
        return -1;
    }

function shouldPreferInvestmentChartPoint(candidate, incumbent) {
        if (candidate?.is_realtime && !incumbent?.is_realtime) return true;
        if (!candidate?.is_realtime && incumbent?.is_realtime) return false;
        return true;
    }

function dedupeInvestmentChartPointsByLedgerDate(chartPoints = []) {
        if (!Array.isArray(chartPoints) || !chartPoints.length) return [];
        return chartPoints.reduce((dedupedPoints, point) => {
            const ledgerDate = runtime.normalizeLedgerDate(point?.date);
            if (!ledgerDate) {
                dedupedPoints.push(point);
                return dedupedPoints;
            }
            const previousPoint = dedupedPoints[dedupedPoints.length - 1];
            const previousLedgerDate = runtime.normalizeLedgerDate(previousPoint?.date);
            if (previousLedgerDate === ledgerDate) {
                dedupedPoints[dedupedPoints.length - 1] = shouldPreferInvestmentChartPoint(point, previousPoint)
                    ? point
                    : previousPoint;
                return dedupedPoints;
            }
            dedupedPoints.push(point);
            return dedupedPoints;
        }, []);
    }

function ensureInvestmentLiveSessionChartSlot(chartPoints = []) {
        const sourcePoints = Array.isArray(chartPoints) ? chartPoints : [];
        const realtimePoints = sourcePoints.filter((point) => point?.is_realtime === true);
        let withoutRealtime = sourcePoints.filter((point) => point?.is_realtime !== true);
        const liveDateKey = getInvestmentDailyEquityLiveSessionDateKey();
        if (liveDateKey && withoutRealtime.length) {
            if (findInvestmentChartPointIndexForLedgerDate(withoutRealtime, liveDateKey) < 0) {
                const latestPoint = withoutRealtime[withoutRealtime.length - 1];
                if (latestPoint) {
                    withoutRealtime = [
                        ...withoutRealtime,
                        {
                            ...latestPoint,
                            date: liveDateKey,
                            is_live_session_slot: true,
                            is_trading_day: true,
                            anchor_ledger_date: '',
                            anchor_ledger_nos: [],
                        },
                    ];
                }
            }
        }
        if (!realtimePoints.length) return withoutRealtime;
        const realtimeByDate = new Map();
        realtimePoints.forEach((point) => {
            const dateKey = runtime.normalizeLedgerDate(point?.date);
            if (dateKey) realtimeByDate.set(dateKey, point);
        });
        const merged = withoutRealtime.map((point) => {
            const dateKey = runtime.normalizeLedgerDate(point?.date);
            return dateKey && realtimeByDate.has(dateKey) ? realtimeByDate.get(dateKey) : point;
        });
        realtimePoints.forEach((point) => {
            const dateKey = runtime.normalizeLedgerDate(point?.date);
            if (dateKey && !merged.some((entry) => runtime.normalizeLedgerDate(entry?.date) === dateKey)) {
                merged.push(point);
            }
        });
        return merged.sort((left, right) => String(left.date || '').localeCompare(String(right.date || '')));
    }

function getInvestmentEquityChartInputPoints(fallbackChartPoints = []) {
        const fallback = Array.isArray(fallbackChartPoints) ? fallbackChartPoints : [];
        if (!isInvestmentDailyEquityLiveRange()) return fallback;
        if (Array.isArray(runtime.state.investmentChartPointsCache) && runtime.state.investmentChartPointsCache.length) {
            return [...runtime.state.investmentChartPointsCache];
        }
        if (Array.isArray(runtime.state.investmentBaseChartPointsCache) && runtime.state.investmentBaseChartPointsCache.length) {
            return ensureInvestmentLiveSessionChartSlot(runtime.state.investmentBaseChartPointsCache);
        }
        return ensureInvestmentLiveSessionChartSlot(fallback);
    }

function buildInvestmentAxisTickIndexes(labels = [], rawDates = [], plotWidth = 0, parseRawDate = null) {
        const normalizedLabels = Array.isArray(labels) ? labels : [];
        if (!normalizedLabels.length) return [];
        const tickIndexes = Array.from(buildInvestmentEquityTickIndexSet(normalizedLabels.length, plotWidth))
            .sort((left, right) => left - right);
        const seenLedgerDates = new Set();
        return tickIndexes.filter((index) => {
            const rawDate = Array.isArray(rawDates) && rawDates[index] !== undefined
                ? rawDates[index]
                : normalizedLabels[index];
            const ledgerDate = runtime.normalizeLedgerDate(rawDate);
            if (!ledgerDate || seenLedgerDates.has(ledgerDate)) return false;
            seenLedgerDates.add(ledgerDate);
            return true;
        });
    }

function buildInvestmentEquityTickIndexSet(count, plotWidth) {
        if (count <= 0) return new Set();
        if (count === 1) return new Set([0]);
        const maxTickCount = plotWidth >= 768 ? 4 : 3;
        if (maxTickCount === 3 || count < 4) {
            return new Set([0, Math.round((count - 1) / 2), count - 1]);
        }
        return new Set([
            0,
            Math.round((count - 1) / 3),
            Math.round(((count - 1) * 2) / 3),
            count - 1,
        ]);
    }

function getInvestmentRealtimeQuoteDateKey(quote) {
        const sessionDate = String(quote?.session_date || '').trim();
        if (sessionDate) return runtime.normalizeLedgerDate(sessionDate);
        const match = String(quote?.timestamp || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
    }

function isInvestmentHongKongTicker(ticker) {
        return String(runtime.normalizeInvestmentTicker(ticker) || '').endsWith('.HK');
    }

function getInvestmentQuoteMarket(quote, ticker = quote?.ticker) {
        const quoteMarket = String(quote?.market || '').trim().toUpperCase();
        if (quoteMarket) return quoteMarket;
        return isInvestmentHongKongTicker(ticker) ? 'HK' : 'US';
    }

function getInvestmentHongKongClockParts(date = new Date()) {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Hong_Kong',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(date).reduce((nextParts, part) => {
            nextParts[part.type] = part.value;
            return nextParts;
        }, {});
        return {
            dateKey: `${parts.year || ''}-${parts.month || ''}-${parts.day || ''}`,
            weekday: String(parts.weekday || ''),
            hour: Number(parts.hour),
            minute: Number(parts.minute),
        };
    }

function getInvestmentHongKongClockSession(date = new Date()) {
        const { weekday, hour, minute } = getInvestmentHongKongClockParts(date);
        if (weekday === 'Sat' || weekday === 'Sun' || !Number.isFinite(hour) || !Number.isFinite(minute)) {
            return 'off';
        }
        const totalMinutes = (hour * 60) + minute;
        const morningOpenMinutes = (9 * 60) + 30;
        const morningCloseMinutes = 12 * 60;
        const afternoonOpenMinutes = 13 * 60;
        const afternoonCloseMinutes = 16 * 60;
        if (totalMinutes >= morningOpenMinutes && totalMinutes < morningCloseMinutes) return 'intraday';
        if (totalMinutes >= afternoonOpenMinutes && totalMinutes < afternoonCloseMinutes) return 'intraday';
        return 'off';
    }

function shouldShowInvestmentHoldingLiveBadge(ticker) {
        const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
        if (!normalizedTicker) return false;
        if (isInvestmentHongKongTicker(normalizedTicker)) {
            return shouldShowInvestmentRealtimePulse(getInvestmentHongKongClockSession());
        }
        return Boolean(getCachedInvestmentMarketSessionState()?.is_realtime_allowed);
    }

function hasInvestmentHoldingLiveBadgeSession(summaries = runtime.state.investmentTickerSummariesCache) {
        return (Array.isArray(summaries) ? summaries : []).some((summary) => (
            summary?.hasOpenPosition
            && shouldShowInvestmentHoldingLiveBadge(summary.ticker)
        ));
    }

function shiftInvestmentCalendarDateKey(dateKey, dayDelta = 0) {
        const normalizedDateKey = runtime.normalizeLedgerDate(dateKey);
        if (!normalizedDateKey || !Number.isFinite(Number(dayDelta))) return '';
        const [year, month, day] = normalizedDateKey.split('-').map((value) => Number(value));
        if (![year, month, day].every(Number.isFinite)) return '';
        const shifted = new Date(Date.UTC(year, month - 1, day + Number(dayDelta)));
        const shiftedYear = shifted.getUTCFullYear();
        const shiftedMonth = String(shifted.getUTCMonth() + 1).padStart(2, '0');
        const shiftedDay = String(shifted.getUTCDate()).padStart(2, '0');
        return `${shiftedYear}-${shiftedMonth}-${shiftedDay}`;
    }

function shouldUseInvestmentUsRealtimeQuote(quote) {
        const currentDateKey = getInvestmentNewYorkClockParts().dateKey;
        const quoteDateKey = getInvestmentRealtimeQuoteDateKey(quote);
        const activeSession = getInvestmentRealtimeClockSession();
        const quoteSession = String(quote?.session || '').trim().toLowerCase();
        if (
            !shouldShowInvestmentRealtimePulse(activeSession)
            || !shouldShowInvestmentRealtimePulse(quoteSession)
            || quoteSession !== activeSession
            || !currentDateKey
            || !quoteDateKey
        ) {
            return false;
        }
        if (activeSession === 'intraday') {
            return quoteDateKey === currentDateKey;
        }
        return true;
    }

function shouldApplyInvestmentRealtimePriceForHoldings(quote) {
        if (shouldUseInvestmentRealtimeQuote(quote)) return true;
        const market = getInvestmentQuoteMarket(quote);
        if (market !== 'US') return false;
        const quoteSession = String(quote?.session || '').trim().toLowerCase();
        const quoteSource = String(quote?.source || '').trim().toLowerCase();
        const activeSession = getInvestmentRealtimeClockSession();
        if (quoteSession === 'post' && (activeSession === 'post' || activeSession === 'off')) {
            return true;
        }
        if (
            quoteSession === 'post'
            && activeSession === 'overnight'
            && quoteSource === 'yfinance'
        ) {
            return true;
        }
        if (quoteSession === 'pre' && (activeSession === 'pre' || activeSession === 'off')) {
            return true;
        }
        return false;
    }

function shouldUseInvestmentHongKongRealtimeQuote(quote) {
        const currentDateKey = getInvestmentHongKongClockParts().dateKey;
        const quoteDateKey = getInvestmentRealtimeQuoteDateKey(quote);
        const activeSession = getInvestmentHongKongClockSession();
        const quoteSession = String(quote?.session || '').trim().toLowerCase();
        return (
            shouldShowInvestmentRealtimePulse(activeSession)
            && shouldShowInvestmentRealtimePulse(quoteSession)
            && quoteSession === activeSession
            && Boolean(currentDateKey)
            && quoteDateKey === currentDateKey
        );
    }

function shouldUseInvestmentRealtimeQuote(quote) {
        const ticker = runtime.normalizeInvestmentTicker(quote?.ticker);
        const market = getInvestmentQuoteMarket(quote, ticker);
        if (market === 'HK') {
            return shouldUseInvestmentHongKongRealtimeQuote(quote);
        }
        return shouldUseInvestmentUsRealtimeQuote(quote);
    }

function portfolioHasOpenHongKongHoldings() {
        const latestSnapshot = Array.isArray(runtime.state.investmentProcessedTransactionsCache) && runtime.state.investmentProcessedTransactionsCache.length
            ? runtime.state.investmentProcessedTransactionsCache[runtime.state.investmentProcessedTransactionsCache.length - 1]
            : null;
        const holdings = latestSnapshot?.aggregate_holdings || latestSnapshot?.holdings || {};
        return Object.keys(holdings).some((ticker) => {
            const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
            const quantity = Number(holdings[ticker]);
            return (
                isInvestmentHongKongTicker(normalizedTicker)
                && Number.isFinite(quantity)
                && Math.abs(quantity) > 1e-9
            );
        });
    }

function getInvestmentRealtimeTickersFromSnapshot(snapshot) {
        const holdings = snapshot?.aggregate_holdings || snapshot?.holdings || {};
        const moneyMarketTickers = runtime.getMoneyMarketTickerSet();
        return Array.from(new Set(
            Object.entries(holdings)
                .filter(([ticker, quantity]) => {
                    const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
                    const numericQuantity = Number(quantity);
                    return (
                        normalizedTicker
                        && !runtime.isForexPairTicker(normalizedTicker)
                        && !moneyMarketTickers.has(normalizedTicker)
                        && Number.isFinite(numericQuantity)
                        && Math.abs(numericQuantity) > 1e-9
                    );
                })
                .map(([ticker]) => runtime.normalizeInvestmentTicker(ticker)),
        ));
    }

async function requestInvestmentRealtimeQuotes(tickers = [], { signal } = {}) {
        const normalizedTickers = Array.from(new Set(
            (Array.isArray(tickers) ? tickers : [])
                .map((ticker) => runtime.normalizeInvestmentTicker(ticker))
                .filter(Boolean),
        ));
        if (!normalizedTickers.length) return [];
        const BATCH_SIZE = 20;
        const batches = [];
        for (let i = 0; i < normalizedTickers.length; i += BATCH_SIZE) {
            batches.push(normalizedTickers.slice(i, i + BATCH_SIZE));
        }
        const batchResults = await Promise.all(
            batches.map(async (batch) => {
                if (!batch.length) return [];
                const params = new URLSearchParams();
                batch.forEach((ticker) => params.append("ticker", ticker));
                try {
                    const response = await fetch(
                        `${getInvestmentRealtimeQuoteEndpoint()}?${params.toString()}`,
                        runtime.buildInvestmentRequestOptions({ signal }),
                    );
                    const payload = await response.json().catch(() => ({}));
                    if (response.ok && payload?.success !== false && Array.isArray(payload?.quotes)) {
                        return payload.quotes;
                    }
                    return [];
                } catch (err) {
                    if (runtime.isLifecycleInterruptedFetch(err)) throw err;
                    return [];
                }
            }),
        );
        return batchResults.flat();
    }

function applyInvestmentSessionRealtimePrices(latestPrices, quotes = []) {
        const safeLatestPrices = latestPrices && typeof latestPrices === 'object' ? latestPrices : {};
        (Array.isArray(quotes) ? quotes : [])
            .filter((quote) => isInvestmentHoldingsRealtimeQuote(quote) && shouldApplyInvestmentRealtimePriceForHoldings(quote))
            .forEach((quote) => {
                const ticker = runtime.normalizeInvestmentTicker(quote?.ticker);
                const price = Number(quote?.price);
                safeLatestPrices[ticker] = price;
                runtime.state.investmentLatestPricesCache[ticker] = price;
                runtime.state.investmentBaseLatestPricesCache[ticker] = price;
            });
        return safeLatestPrices;
    }

function getInvestmentEmbeddedRealtimeQuotes() {
        const quotes = window.WORTHWARD_INVESTMENT_DATA?.realtime_quotes;
        return Array.isArray(quotes) ? quotes : [];
    }

function mergeInvestmentRealtimeQuotePayloads(...quoteGroups) {
        const merged = new Map();
        quoteGroups.flat().forEach((quote) => {
            const ticker = runtime.normalizeInvestmentTicker(quote?.ticker);
            if (!ticker || !isInvestmentHoldingsRealtimeQuote(quote)) return;
            merged.set(ticker, quote);
        });
        return Array.from(merged.values());
    }

async function bootstrapInvestmentSessionRealtimeQuotes(latestSnapshot) {
        const tickers = getInvestmentRealtimeTickersFromSnapshot(latestSnapshot);
        if (!tickers.length) return [];
        try {
            return await requestInvestmentRealtimeQuotes(tickers);
        } catch (error) {
            if (!runtime.isLifecycleInterruptedFetch(error)) {
                console.warn('Unable to bootstrap investment session realtime quotes', error);
            }
            return [];
        }
    }

function resetInvestmentRealtimeChartState() {
        const baseChartPoints = Array.isArray(runtime.state.investmentBaseChartPointsCache)
            ? runtime.state.investmentBaseChartPointsCache.filter((point) => point?.is_realtime !== true)
            : [];
        const hasRealtimePoint = Array.isArray(runtime.state.investmentChartPointsCache)
            && runtime.state.investmentChartPointsCache.some((point) => point?.is_realtime === true);
        if (!hasRealtimePoint || !baseChartPoints.length) return;
        runtime.state.investmentChartPointsCache = [...baseChartPoints];
        if (!isInvestmentDailyEquityLiveRange()) return;
        runtime.renderInvestmentHistoryTableRows(
            runtime.state.investmentProcessedTransactionsCache,
            baseChartPoints,
            { resetPage: false, scrollToTop: false },
        );
        runtime.updateInvestmentEquityChartDisplay(getInvestmentEquityChartInputPoints(baseChartPoints));
        const latestBasePoint = baseChartPoints[baseChartPoints.length - 1] || null;
        if (!latestBasePoint) return;
        runtime.renderInvestmentDummyPortfolioDonut(latestBasePoint, runtime.state.investmentDummyTickerProfiles);
        runtime.syncInvestmentDummyDonutFromInteraction();
        if (runtime.state.activeInvestmentView === 'stock_details') {
            runtime.syncInvestmentStockDetailsDonutFromInteraction();
        }
    }

function resetInvestmentRealtimeState() {
        const baseChartPoints = Array.isArray(runtime.state.investmentBaseChartPointsCache)
            ? runtime.state.investmentBaseChartPointsCache.filter((point) => point?.is_realtime !== true)
            : [];
        const hasRealtimePoint = Array.isArray(runtime.state.investmentChartPointsCache)
            && runtime.state.investmentChartPointsCache.some((point) => point?.is_realtime === true);
        const latestSnapshot = Array.isArray(runtime.state.investmentProcessedTransactionsCache) && runtime.state.investmentProcessedTransactionsCache.length
            ? runtime.state.investmentProcessedTransactionsCache[runtime.state.investmentProcessedTransactionsCache.length - 1]
            : null;
        if (!hasRealtimePoint || !baseChartPoints.length || !latestSnapshot) return;
        const baseLatestPrices = runtime.state.investmentBaseLatestPricesCache && typeof runtime.state.investmentBaseLatestPricesCache === 'object'
            ? { ...runtime.state.investmentBaseLatestPricesCache }
            : {};
        runtime.state.investmentLatestPricesCache = { ...baseLatestPrices };
        runtime.state.investmentChartPointsCache = [...baseChartPoints];
        runtime.updateDashboardWithEquity(
            runtime.state.investmentProcessedTransactionsCache,
            latestSnapshot,
            baseLatestPrices,
            runtime.state.investmentRawTransactionsCache,
            baseChartPoints,
            runtime.state.investmentTickerClosePricesCache,
            { refreshStockDetailsPanel: false },
        );
    }

function getInvestmentRealtimeOpenTickers() {
        const latestSnapshot = Array.isArray(runtime.state.investmentProcessedTransactionsCache) && runtime.state.investmentProcessedTransactionsCache.length
            ? runtime.state.investmentProcessedTransactionsCache[runtime.state.investmentProcessedTransactionsCache.length - 1]
            : null;
        const holdings = latestSnapshot?.aggregate_holdings || latestSnapshot?.holdings || {};
        const moneyMarketTickers = runtime.getMoneyMarketTickerSet();
        return Object.entries(holdings)
            .filter(([ticker, quantity]) => {
                const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
                const numericQuantity = Number(quantity);
                return (
                    normalizedTicker
                    && !runtime.isForexPairTicker(normalizedTicker)
                    && !moneyMarketTickers.has(normalizedTicker)
                    && Number.isFinite(numericQuantity)
                    && Math.abs(numericQuantity) > 1e-9
                );
            })
            .map(([ticker]) => runtime.normalizeInvestmentTicker(ticker));
    }

function getInvestmentRealtimeHoldingsTickers() {
        const moneyMarketTickers = runtime.getMoneyMarketTickerSet();
        return Array.from(new Set(runtime.getAvailableInvestmentStockTickers()))
            .filter((ticker) => ticker && !runtime.isForexPairTicker(ticker) && !moneyMarketTickers.has(ticker));
    }

function isInvestmentHoldingsRealtimeQuote(quote) {
        const ticker = runtime.normalizeInvestmentTicker(quote?.ticker);
        const price = Number(quote?.price);
        return Boolean(ticker) && Number.isFinite(price) && price > 0;
    }

function rememberInvestmentRealtimeQuotes(quotes = []) {
        (Array.isArray(quotes) ? quotes : []).forEach((quote) => {
            if (!isInvestmentHoldingsRealtimeQuote(quote)) return;
            const ticker = runtime.normalizeInvestmentTicker(quote?.ticker);
            runtime.investmentRealtimeQuotesByTicker.set(ticker, { ...quote, ticker });
        });
    }

function getInvestmentRealtimeQuoteForTicker(ticker) {
        const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
        if (!normalizedTicker) return null;
        const candidates = Array.from(new Set([
            normalizedTicker,
            ...(typeof getInvestmentMarketStoreTickerCandidates === 'function'
                ? getInvestmentMarketStoreTickerCandidates(normalizedTicker)
                : []),
        ].map((candidate) => runtime.normalizeInvestmentTicker(candidate)).filter(Boolean)));
        return candidates
            .map((candidate) => runtime.investmentRealtimeQuotesByTicker.get(candidate))
            .find((quote) => isInvestmentHoldingsRealtimeQuote(quote)) || null;
    }

function getInvestmentStockDetailsRealtimePulseTarget(ticker) {
        const quote = getInvestmentRealtimeQuoteForTicker(ticker);
        if (
            !quote
            || !shouldUseInvestmentRealtimeQuote(quote)
            || !runtime.isRealtimeQuotePulseProviderEligible(quote)
        ) {
            return null;
        }
        const price = Number(quote.price);
        if (!Number.isFinite(price) || price <= 0) return null;
        return {
            price,
            session: String(quote.session || '').trim().toLowerCase(),
            source: String(quote.source || '').trim().toLowerCase(),
        };
    }

function buildInvestmentRealtimeTimestamp(quotes = []) {
        const timestamps = (Array.isArray(quotes) ? quotes : [])
            .map((quote) => String(quote?.timestamp || '').trim())
            .filter(Boolean)
            .sort();
        if (timestamps.length) return timestamps[timestamps.length - 1];

        const quoteMarkets = new Set(
            (Array.isArray(quotes) ? quotes : [])
                .map((quote) => String(quote?.market || '').trim().toUpperCase())
                .filter(Boolean),
        );
        const sessionState = getSafeInvestmentMarketSessionState();
        const sessionAsOf = String(sessionState?.as_of || '').trim();
        const parsedSessionAsOf = sessionAsOf ? new Date(sessionAsOf) : null;
        const sessionClock = parsedSessionAsOf && !Number.isNaN(parsedSessionAsOf.getTime())
            ? parsedSessionAsOf
            : new Date();
        const clockParts = quoteMarkets.has('US')
            ? getInvestmentNewYorkClockParts(sessionClock)
            : (quoteMarkets.has('HK')
                ? getInvestmentHongKongClockParts(sessionClock)
                : (sessionState?.is_realtime_allowed
                    ? getInvestmentNewYorkClockParts(sessionClock)
                    : null));
        if (
            clockParts?.dateKey
            && Number.isFinite(clockParts.hour)
            && Number.isFinite(clockParts.minute)
        ) {
            const hours = String(clockParts.hour).padStart(2, '0');
            const minutes = String(clockParts.minute).padStart(2, '0');
            return `${clockParts.dateKey} ${hours}:${minutes}`;
        }

        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}`;
    }

function buildInvestmentRealtimeChartPoints(quotes = []) {
        const sourceBaseChartPoints = Array.isArray(runtime.state.investmentBaseChartPointsCache)
            ? runtime.state.investmentBaseChartPointsCache.filter((point) => point?.is_realtime !== true)
            : [];
        const baseChartPoints = isInvestmentDailyEquityLiveRange()
            ? ensureInvestmentLiveSessionChartSlot(sourceBaseChartPoints)
            : [...sourceBaseChartPoints];
        if (!baseChartPoints.length || !runtime.state.investmentProcessedTransactionsCache.length) return baseChartPoints;

        const latestSnapshot = runtime.state.investmentProcessedTransactionsCache[runtime.state.investmentProcessedTransactionsCache.length - 1];
        const latestBasePoint = baseChartPoints[baseChartPoints.length - 1];
        const quoteByTicker = new Map(
            (Array.isArray(quotes) ? quotes : [])
                .map((quote) => [runtime.normalizeInvestmentTicker(quote?.ticker), quote])
                .filter(([ticker, quote]) => ticker && Number.isFinite(Number(quote?.price)))
        );
        if (!quoteByTicker.size) return baseChartPoints;

        const livePrices = { ...runtime.state.investmentLatestPricesCache };
        quoteByTicker.forEach((quote, ticker) => {
            const price = Number(quote?.price);
            if (Number.isFinite(price) && price > 0) {
                livePrices[ticker] = price;
            }
        });

        const baseCurrency = runtime.getInvestmentBaseCurrency();
        const fxTimeline = runtime.buildInvestmentFxRateTimeline(runtime.state.investmentProcessedTransactionsCache, baseCurrency);
        const valuationDate = runtime.normalizeLedgerDate(buildInvestmentRealtimeTimestamp(quotes))
            || runtime.normalizeLedgerDate(latestSnapshot?.date)
            || runtime.normalizeLedgerDate(latestBasePoint?.date);
        const holdings = latestSnapshot?.aggregate_holdings || latestSnapshot?.holdings || {};
        const moneyMarketTickers = runtime.getMoneyMarketTickerSet();
        let aggregateMarketValue = 0;
        const holdingsMarketValues = {};
        const holdingsQuotePrices = {};

        Object.entries(holdings).forEach(([ticker, quantity]) => {
            const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
            const numericQuantity = Number(quantity);
            if (!normalizedTicker || runtime.isForexPairTicker(normalizedTicker) || !Number.isFinite(numericQuantity)) return;
            let price = Number(livePrices[normalizedTicker]);
            if (
                moneyMarketTickers.has(normalizedTicker)
                && (!Number.isFinite(price) || price <= 0)
            ) {
                const anchoredPrice = latestSnapshot?.aggregate_money_market_anchors?.[normalizedTicker]
                    ?? latestSnapshot?.money_market_anchors?.[normalizedTicker];
                if (Number.isFinite(Number(anchoredPrice))) {
                    price = Number(anchoredPrice);
                }
            }
            if (!Number.isFinite(price) || price <= 0) return;
            const quoteCurrency = runtime.getTickerQuoteCurrency(normalizedTicker);
            const marketValue = runtime.convertAmountToBaseCurrency(
                numericQuantity * price,
                quoteCurrency,
                valuationDate,
                fxTimeline,
                baseCurrency,
            );
            holdingsMarketValues[normalizedTicker] = marketValue;
            holdingsQuotePrices[normalizedTicker] = price;
            aggregateMarketValue += marketValue;
        });

        const aggregateRunningCash = Number(latestSnapshot?.aggregate_running_cash ?? latestSnapshot?.running_cash) || 0;
        const aggregatePendingSettlementCash = Number(latestSnapshot?.aggregate_pending_settlement_cash) || 0;
        const rawAggregateDisplayCash = Number(latestSnapshot?.aggregate_display_cash);
        const aggregateDisplayCash = Number.isFinite(rawAggregateDisplayCash)
            ? rawAggregateDisplayCash
            : aggregateRunningCash + aggregatePendingSettlementCash;
        const holdingsRealtimeState = runtime.getInvestmentHoldingsRealtimeState();
        const realtimeHoldingsMarketValues = {};
        const realtimeHoldingsQuotePrices = { ...holdingsQuotePrices };
        (holdingsRealtimeState?.summaries || []).forEach((summary) => {
            const marketValue = Number(summary?.marketValue);
            if (!summary?.hasOpenPosition || !Number.isFinite(marketValue)) return;
            realtimeHoldingsMarketValues[summary.ticker] = marketValue;
            const lastPrice = Number(summary?.lastPrice);
            if (Number.isFinite(lastPrice) && lastPrice > 0) {
                realtimeHoldingsQuotePrices[summary.ticker] = lastPrice;
            }
        });
        const resolvedMarketValue = holdingsRealtimeState
            ? Object.values(realtimeHoldingsMarketValues).reduce(
                (sum, marketValue) => sum + marketValue,
                0,
            )
            : aggregateMarketValue;
        const resolvedDisplayCash = Number.isFinite(Number(holdingsRealtimeState?.aggregateCash))
            ? Number(holdingsRealtimeState.aggregateCash)
            : aggregateDisplayCash;
        const resolvedTotalEquity = Number.isFinite(Number(holdingsRealtimeState?.totalEquity))
            ? Number(holdingsRealtimeState.totalEquity)
            : resolvedDisplayCash + resolvedMarketValue;
        const resolvedHoldingsMarketValues = holdingsRealtimeState
            ? realtimeHoldingsMarketValues
            : holdingsMarketValues;
        const resolvedHoldingsQuotePrices = holdingsRealtimeState
            ? realtimeHoldingsQuotePrices
            : holdingsQuotePrices;
        const realtimeTimestamp = buildInvestmentRealtimeTimestamp(quotes);
        const realtimeDateKey = getInvestmentLiveSessionDateKey()
            || runtime.normalizeLedgerDate(realtimeTimestamp)
            || runtime.normalizeLedgerDate(latestBasePoint?.date);
        const session = Array.from(quoteByTicker.values()).find((quote) => quote?.session)?.session || 'realtime';
        const realtimeSource = runtime.resolveRealtimeQuoteSource(Array.from(quoteByTicker.values()));
        const targetIndex = findInvestmentChartPointIndexForLedgerDate(baseChartPoints, realtimeDateKey);
        const anchorPoint = targetIndex >= 0 ? baseChartPoints[targetIndex] : (latestBasePoint || {});
        const realtimePoint = {
            ...anchorPoint,
            date: realtimeDateKey || realtimeTimestamp,
            realtime_timestamp: realtimeTimestamp,
            running_cash: aggregateRunningCash,
            aggregate_running_cash: aggregateRunningCash,
            aggregate_display_cash: resolvedDisplayCash,
            market_value: resolvedMarketValue,
            aggregate_market_value: resolvedMarketValue,
            holdings_market_values: resolvedHoldingsMarketValues,
            aggregate_holdings_market_values: resolvedHoldingsMarketValues,
            holdings_quote_prices: resolvedHoldingsQuotePrices,
            aggregate_holdings_quote_prices: resolvedHoldingsQuotePrices,
            total_equity: resolvedTotalEquity,
            aggregate_total_equity: resolvedTotalEquity,
            anchor_ledger_date: '',
            anchor_ledger_nos: [],
            cash_in_amount: 0,
            cash_out_amount: 0,
            net_transfer_amount: 0,
            cumulative_net_transfer_amount: Number(latestBasePoint?.cumulative_net_transfer_amount) || 0,
            is_trading_day: false,
            is_realtime: true,
            is_live_session_slot: false,
            realtime_session: session,
            realtime_source: realtimeSource,
            previous_trading_point_index: Number.isFinite(Number(anchorPoint?.previous_trading_point_index))
                ? Number(anchorPoint.previous_trading_point_index)
                : (targetIndex > 0 ? targetIndex - 1 : -1),
        };

        if (targetIndex >= 0) {
            const nextChartPoints = [...baseChartPoints];
            nextChartPoints[targetIndex] = realtimePoint;
            return dedupeInvestmentChartPointsByLedgerDate(nextChartPoints);
        }
        return dedupeInvestmentChartPointsByLedgerDate([...baseChartPoints, realtimePoint]);
    }

function applyInvestmentRealtimeQuotes(quotes = []) {
        const holdingsQuotes = (Array.isArray(quotes) ? quotes : [])
            .filter((quote) => isInvestmentHoldingsRealtimeQuote(quote));
        rememberInvestmentRealtimeQuotes(holdingsQuotes);
        runtime.syncInvestmentStockDetailsLivePulse();
        const liveSessionQuotes = holdingsQuotes.filter((quote) => shouldApplyInvestmentRealtimePriceForHoldings(quote));
        if (liveSessionQuotes.length) {
            liveSessionQuotes.forEach((quote) => {
                const ticker = runtime.normalizeInvestmentTicker(quote?.ticker);
                const price = Number(quote?.price);
                runtime.state.investmentLatestPricesCache[ticker] = price;
                runtime.state.investmentBaseLatestPricesCache[ticker] = price;
            });
            runtime.syncInvestmentHoldingsRealtimeValues();
        }

        if (!liveSessionQuotes.length) {
            if (shouldRunInvestmentRealtimeQuotes()) {
                resetInvestmentRealtimeChartState();
            }
            return;
        }
        const liveChartPoints = buildInvestmentRealtimeChartPoints(liveSessionQuotes);
        if (!liveChartPoints.length) return;
        const latestRealtimePoint = [...liveChartPoints]
            .reverse()
            .find((point) => point?.is_realtime === true) || null;
        if (isInvestmentOverviewIntradayEquityRange()) {
            if (runtime.rememberInvestmentOverviewRealtimeLinePoint(latestRealtimePoint)) {
                runtime.syncInvestmentEquityChartRealtime(liveChartPoints);
                runtime.renderInvestmentDummyPortfolioDonut(latestRealtimePoint, runtime.state.investmentDummyTickerProfiles);
                runtime.syncInvestmentDummyDonutFromInteraction();
            }
            return;
        }
        runtime.state.investmentChartPointsCache = liveChartPoints;
        runtime.renderInvestmentHistoryTableRows(runtime.state.investmentProcessedTransactionsCache, liveChartPoints, { resetPage: false, scrollToTop: false });
        runtime.syncInvestmentEquityChartRealtime(liveChartPoints);
        const latestLiveChartPoint = latestRealtimePoint || liveChartPoints[liveChartPoints.length - 1] || null;
        if (latestLiveChartPoint) {
            runtime.renderInvestmentDummyPortfolioDonut(latestLiveChartPoint, runtime.state.investmentDummyTickerProfiles);
            runtime.syncInvestmentDummyDonutFromInteraction();
            if (runtime.state.activeInvestmentView === 'stock_details') {
                runtime.syncInvestmentStockDetailsDonutFromInteraction();
            }
        }
    }

function scheduleInvestmentRealtimeQuotePolling() {
        runtime.investmentRealtimeQuotePoller.schedule();
    }

async function pollInvestmentRealtimeQuotes() {
        return runtime.investmentRealtimeQuotePoller.poll();
    }

function restartInvestmentRealtimeQuotePolling() {
        void runtime.investmentRealtimeQuotePoller.restart();
    }

function readInvestmentPageMemory() {
        try {
            const raw = runtime.preferenceStorage.local.getItem(runtime.INVESTMENT_PAGE_MEMORY_STORAGE_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_error) {
            return {};
        }
    }

function writeInvestmentPageMemory(nextMemory) {
        try {
            runtime.preferenceStorage.local.setItem(runtime.INVESTMENT_PAGE_MEMORY_STORAGE_KEY, JSON.stringify(nextMemory));
        } catch (_error) {
        }
    }

function rememberInvestmentPageState({
        view = runtime.state.activeInvestmentView || 'chart',
        ticker = runtime.state.selectedInvestmentStockTicker || '',
        range = runtime.state.selectedInvestmentStockDetailsRange || 'max',
        equityRange = runtime.state.selectedInvestmentEquityRange || 'max',
        metricsBroker,
    } = {}) {
        const normalizedView = normalizeInvestmentView(view);
        const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
        const normalizedRange = runtime.normalizeInvestmentStockDetailsRange(range);
        const normalizedEquityRange = runtime.normalizeInvestmentEquityRange(equityRange);
        const nextUrl = runtime.buildInvestmentViewUrl(normalizedView, normalizedTicker);
        const currentMemory = readInvestmentPageMemory();
        const rawMetricsBroker = metricsBroker === undefined
            ? currentMemory.last_metrics_broker || runtime.state.investmentBrokerSummarySelectedCode
            : metricsBroker;
        const normalizedMetricsBroker = String(rawMetricsBroker || 'all').trim().toLowerCase() === 'all'
            ? 'all'
            : runtime.normalizeInvestmentBroker(rawMetricsBroker);
        writeInvestmentPageMemory({
            ...currentMemory,
            page_key: 'investment',
            page_path: '/trade/investment',
            last_used_at: new Date().toISOString(),
            last_view: normalizedView,
            last_stock_ticker: normalizedTicker,
            last_stock_details_range: normalizedRange,
            last_equity_range: normalizedEquityRange,
            last_metrics_broker: normalizedMetricsBroker,
            last_stock_details_url: normalizedView === 'stock_details' ? nextUrl : runtime.buildInvestmentViewUrl('stock_details', normalizedTicker),
        });
    }

function restoreRememberedInvestmentPageState() {
        const memory = readInvestmentPageMemory();
        const rememberedTicker = runtime.normalizeInvestmentTicker(memory.last_stock_ticker || '');
        const rememberedRange = runtime.normalizeInvestmentStockDetailsRange(memory.last_stock_details_range || 'max');
        const rememberedEquityRange = runtime.normalizeInvestmentEquityRange(memory.last_equity_range || 'max');
        const rememberedMetricsBroker = String(memory.last_metrics_broker || 'all').trim().toLowerCase() === 'all'
            ? 'all'
            : runtime.normalizeInvestmentBroker(memory.last_metrics_broker);
        if (rememberedTicker) {
            runtime.state.selectedInvestmentStockTicker = rememberedTicker;
        }
        runtime.state.selectedInvestmentStockDetailsRange = rememberedRange;
        runtime.state.selectedInvestmentEquityRange = rememberedEquityRange;
        runtime.state.investmentBrokerSummarySelectedCode = rememberedMetricsBroker;
        runtime.state.investmentBrokerSummarySelectionInitialized = false;
        return normalizeInvestmentView(memory.last_view || 'chart');
    }

function restoreRememberedInvestmentLocation() {
        const currentHash = String(window.location.hash || '').trim();
        const currentTicker = runtime.getInvestmentLocationTicker();
        if (currentHash || currentTicker) return false;
        const memory = readInvestmentPageMemory();
        if (normalizeInvestmentView(memory.last_view || '') !== 'stock_details') return false;
        const rememberedUrl = String(memory.last_stock_details_url || '').trim();
        if (!rememberedUrl) return false;
        try {
            const parsed = new URL(rememberedUrl, window.location.origin);
            if (parsed.pathname !== window.location.pathname) return false;
            window.history.replaceState(null, '', `${parsed.pathname}${parsed.search}${parsed.hash}`);
            return true;
        } catch (_error) {
            return false;
        }
    }

function normalizeInvestmentInternalTransferBindings(rawBindings) {
        if (!rawBindings || typeof rawBindings !== 'object') return {};
        return Object.entries(rawBindings).reduce((nextBindings, [sourceKey, targetKey]) => {
            const normalizedSourceKey = String(sourceKey || '').trim();
            const normalizedTargetKey = String(targetKey || '').trim();
            if (!normalizedSourceKey || !normalizedTargetKey) return nextBindings;
            nextBindings[normalizedSourceKey] = normalizedTargetKey;
            return nextBindings;
        }, {});
    }

function normalizeInvestmentInternalTransferIgnoredSourceKeys(rawKeys) {
        const values = Array.isArray(rawKeys)
            ? rawKeys
            : (rawKeys && typeof rawKeys === 'object' ? Object.keys(rawKeys) : []);
        return Array.from(new Set(
            values
                .map((sourceKey) => String(sourceKey || '').trim())
                .filter(Boolean),
        ));
    }

function readInvestmentInternalTransferBindings() {
        return normalizeInvestmentInternalTransferBindings(
            window.WORTHWARD_INVESTMENT_DATA?.manual_internal_transfer_bindings
        );
    }

function writeInvestmentInternalTransferBindings(nextBindings) {
        const normalizedBindings = normalizeInvestmentInternalTransferBindings(nextBindings);
        if (!window.WORTHWARD_INVESTMENT_DATA || typeof window.WORTHWARD_INVESTMENT_DATA !== 'object') {
            return;
        }
        window.WORTHWARD_INVESTMENT_DATA.manual_internal_transfer_bindings = normalizedBindings;
    }

function readInvestmentInternalTransferIgnoredSourceKeys() {
        return new Set(normalizeInvestmentInternalTransferIgnoredSourceKeys(
            window.WORTHWARD_INVESTMENT_DATA?.manual_internal_transfer_ignored_source_keys,
        ));
    }

function writeInvestmentInternalTransferIgnoredSourceKeys(nextKeys) {
        if (!window.WORTHWARD_INVESTMENT_DATA || typeof window.WORTHWARD_INVESTMENT_DATA !== 'object') {
            return;
        }
        window.WORTHWARD_INVESTMENT_DATA.manual_internal_transfer_ignored_source_keys = (
            normalizeInvestmentInternalTransferIgnoredSourceKeys(nextKeys)
        );
    }

async function rememberInvestmentInternalTransferBinding(
        sourceKey,
        targetKey,
        action = 'bind',
    ) {
        const normalizedSourceKey = String(sourceKey || '').trim();
        const normalizedTargetKey = String(targetKey || '').trim();
        if (!normalizedSourceKey) throw new Error('A source transfer key is required.');
        const normalizedAction = ['bind', 'ignore', 'restore'].includes(String(action || '').trim().toLowerCase())
            ? String(action || '').trim().toLowerCase()
            : 'bind';
        const requestBody = {
            source_key: normalizedSourceKey,
            target_key: normalizedTargetKey,
        };
        if (normalizedAction !== 'bind') requestBody.action = normalizedAction;
        const response = await fetch('/api/investment/internal-transfer-binding', {
            ...runtime.buildInvestmentRequestOptions({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            }),
        });
        let payload = null;
        try {
            payload = await response.json();
        } catch (_error) {
        }
        if (!response.ok || payload?.success !== true) {
            throw new Error(
                String(payload?.error || 'The internal transfer binding could not be saved.').trim()
            );
        }
        if (payload && Object.prototype.hasOwnProperty.call(payload, 'manual_internal_transfer_bindings')) {
            writeInvestmentInternalTransferBindings(payload.manual_internal_transfer_bindings);
        }
        if (payload && Object.prototype.hasOwnProperty.call(payload, 'manual_internal_transfer_ignored_source_keys')) {
            writeInvestmentInternalTransferIgnoredSourceKeys(
                payload.manual_internal_transfer_ignored_source_keys,
            );
        }
        if (payload?.summary && window.WORTHWARD_INVESTMENT_DATA) {
            window.WORTHWARD_INVESTMENT_DATA.summary = payload.summary;
        }
        if (payload?.broker_summaries && window.WORTHWARD_INVESTMENT_DATA) {
            window.WORTHWARD_INVESTMENT_DATA.broker_summaries = payload.broker_summaries;
        }
        applyInvestmentSecurityTransferBasisToTransactions(runtime.state.investmentRawTransactionsCache);
        return payload || {success: true};
    }

function getInvestmentSecurityTransferReconciliation() {
        const summary = window.WORTHWARD_INVESTMENT_DATA?.summary;
        const reconciliation = summary?.security_transfer_reconciliation;
        return reconciliation && typeof reconciliation === 'object' ? reconciliation : {};
    }

function applyInvestmentSecurityTransferBasisToTransactions(transactions = []) {
        const reconciliation = getInvestmentSecurityTransferReconciliation();
        const basisEntries = Array.isArray(reconciliation?.transfer_basis)
            ? reconciliation.transfer_basis
            : [];
        if (!basisEntries.length) {
            (Array.isArray(transactions) ? transactions : []).forEach((txn) => {
                if (!txn || typeof txn !== 'object') return;
                [
                    'carried_cost_basis_raw',
                    'carried_cost_basis_status',
                    'carried_cost_basis_method',
                    'carried_cost_basis_method_label',
                    'carried_cost_basis_quantity_raw',
                    'carried_cost_basis_source_transfer_key',
                    'carried_cost_basis_allocations',
                    'transfer_out_cost_basis_raw',
                    'transfer_out_cost_basis_status',
                    'transfer_out_cost_basis_method',
                    'transfer_out_cost_basis_method_label',
                    'transfer_out_cost_basis_quantity_raw',
                    'transfer_out_cost_basis_allocations',
                ].forEach((fieldName) => delete txn[fieldName]);
            });
            return;
        }
        const bySourceKey = new Map(
            basisEntries
                .map((entry) => [String(entry?.source_key || '').trim(), entry])
                .filter(([key]) => Boolean(key)),
        );
        const byTargetKey = new Map(
            basisEntries
                .map((entry) => [String(entry?.target_key || '').trim(), entry])
                .filter(([key]) => Boolean(key)),
        );
        (Array.isArray(transactions) ? transactions : []).forEach((txn) => {
            if (!txn || typeof txn !== 'object') return;
            const transactionKey = String(txn?.manual_internal_transfer_key || '').trim();
            const sourceEntry = bySourceKey.get(transactionKey);
            const targetEntry = byTargetKey.get(transactionKey);
            if (sourceEntry) {
                const basis = String(sourceEntry.source_transfer_out_cost_basis || '').trim();
                txn.transfer_out_cost_basis_raw = basis;
                txn.transfer_out_cost_basis_status = String(sourceEntry.status || '').trim();
                txn.transfer_out_cost_basis_method = String(sourceEntry.method || '').trim();
                txn.transfer_out_cost_basis_method_label = String(sourceEntry.method_label || '').trim();
                txn.transfer_out_cost_basis_quantity_raw = String(sourceEntry.quantity || '').trim();
            }
            if (targetEntry) {
                const basis = String(targetEntry.carried_cost_basis || '').trim();
                txn.carried_cost_basis_raw = basis;
                txn.carried_cost_basis_status = String(targetEntry.status || '').trim();
                txn.carried_cost_basis_method = String(targetEntry.method || '').trim();
                txn.carried_cost_basis_method_label = String(targetEntry.method_label || '').trim();
                txn.carried_cost_basis_quantity_raw = String(targetEntry.quantity || '').trim();
                txn.carried_cost_basis_source_transfer_key = String(targetEntry.source_key || '').trim();
            }
        });
    }

function refreshInvestmentAggregateSecurityTransferState(transactions = []) {
        applyInvestmentSecurityTransferBasisToTransactions(transactions);
        const reconciliation = getInvestmentSecurityTransferReconciliation();
        const overlay = reconciliation?.aggregate_overlay && typeof reconciliation.aggregate_overlay === 'object'
            ? reconciliation.aggregate_overlay
            : {};
        const activeReceiptKeys = new Set(
            (Array.isArray(overlay.active_receipt_keys) ? overlay.active_receipt_keys : [])
                .map((key) => String(key || '').trim())
                .filter(Boolean),
        );
        const sourceAttributionRequiredReceiptKeys = new Set(
            (Array.isArray(overlay.source_attribution_required_receipt_keys)
                ? overlay.source_attribution_required_receipt_keys
                : [])
                .map((key) => String(key || '').trim())
                .filter(Boolean),
        );
        const invalidReceiptKeys = new Set(
            (Array.isArray(overlay.invalid_receipt_keys) ? overlay.invalid_receipt_keys : [])
                .map((key) => String(key || '').trim())
                .filter(Boolean),
        );
        const excludedReceiptKeys = new Set([
            ...activeReceiptKeys,
            ...sourceAttributionRequiredReceiptKeys,
            ...invalidReceiptKeys,
        ]);
        const pnlUnavailableTickers = new Set(
            (Array.isArray(reconciliation?.pnl_unavailable_tickers)
                ? reconciliation.pnl_unavailable_tickers
                : [])
                .map((ticker) => runtime.getInvestmentCanonicalTicker(ticker))
                .filter(Boolean),
        );
        const aggregateHoldingsUnavailable = reconciliation?.aggregate_holdings_available === false;
        const hasUsableAggregateTransactions = (Array.isArray(transactions) ? transactions : []).some((txn) => {
            const receiptKey = String(txn?.manual_internal_transfer_key || '').trim();
            return !receiptKey || !excludedReceiptKeys.has(receiptKey);
        });
        const aggregateSurfaceBlocked = (
            aggregateHoldingsUnavailable
            && (!excludedReceiptKeys.size || !hasUsableAggregateTransactions)
        );
        runtime.state.investmentAggregateSecurityTransferState = {
            // Exclude only receipt rows whose source attribution is unresolved.
            // Keep unrelated aggregate evidence available; the affected ticker's
            // carried basis remains explicitly unavailable below.
            blocked: aggregateSurfaceBlocked,
            reconciliationBlocked: aggregateHoldingsUnavailable,
            activeReceiptKeys,
            excludedReceiptKeys,
            pnlUnavailableTickers,
        };
        const sourceAttributionByReceiptKey = window.WORTHWARD_INVESTMENT_DATA?.manual_security_transfer_attributions;
        const normalizedAttributions = sourceAttributionByReceiptKey && typeof sourceAttributionByReceiptKey === 'object'
            ? sourceAttributionByReceiptKey
            : {};
        const unresolvedByReceiptKey = new Map(
            (Array.isArray(reconciliation?.unreconciled_inbounds)
                ? reconciliation.unreconciled_inbounds
                : [])
                .map((item) => [String(item?.record_key || '').trim(), item])
                .filter(([key]) => Boolean(key)),
        );
        const attributionStatusByReceiptKey = new Map(
            (Array.isArray(overlay.attribution_statuses) ? overlay.attribution_statuses : [])
                .map((item) => [String(item?.receipt_key || '').trim(), item])
                .filter(([key]) => Boolean(key)),
        );
        (Array.isArray(transactions) ? transactions : []).forEach((txn) => {
            const receiptKey = String(txn?.manual_internal_transfer_key || '').trim();
            const unresolved = unresolvedByReceiptKey.get(receiptKey);
            const attributionStatus = attributionStatusByReceiptKey.get(receiptKey);
            txn.security_transfer_receipt_key = receiptKey;
            txn.security_transfer_attribution_status = String(
                attributionStatus?.status
                || unresolved?.aggregate_overlay_status
                || ''
            ).trim();
            txn.security_transfer_requires_attribution = sourceAttributionRequiredReceiptKeys.has(receiptKey);
            txn.security_transfer_attribution = normalizedAttributions[receiptKey] || null;
            txn.security_transfer_pnl_unavailable = pnlUnavailableTickers.has(
                runtime.getInvestmentCanonicalTicker(txn?.ticker),
            );
        });
        return runtime.state.investmentAggregateSecurityTransferState;
    }

function getInvestmentAggregateSecurityTransferBlockedMessage() {
        const reconciliation = getInvestmentSecurityTransferReconciliation();
        const overlay = reconciliation?.aggregate_overlay && typeof reconciliation.aggregate_overlay === 'object'
            ? reconciliation.aggregate_overlay
            : {};
        const requiredReceiptCount = (Array.isArray(overlay.source_attribution_required_receipt_keys)
            ? overlay.source_attribution_required_receipt_keys
            : []).map((key) => String(key || '').trim()).filter(Boolean).length;
        const invalidReceiptCount = (Array.isArray(overlay.invalid_receipt_keys)
            ? overlay.invalid_receipt_keys
            : []).map((key) => String(key || '').trim()).filter(Boolean).length;
        const receiptCount = requiredReceiptCount || invalidReceiptCount;
        if (!receiptCount) {
            return 'All brokers holdings, equity, and P&L are unavailable until the outstanding cross-broker security-transfer evidence is reconciled. Transaction history remains available as immutable broker evidence; no source transfer-out or cost basis is inferred.';
        }
        const receiptLabel = receiptCount === 1 ? 'receipt' : 'receipts';
        const actionVerb = receiptCount === 1 ? 'requires' : 'require';
        const action = invalidReceiptCount
            ? 'uniquely matching source-transfer evidence'
            : 'a confirmed concrete source broker and account';
        return `All brokers holdings, equity, and P&L are unavailable until ${receiptCount} Schwab security-transfer ${receiptLabel} ${actionVerb} ${action}. Transaction history remains available as immutable broker evidence; no source transfer-out or cost basis is inferred.`;
    }

function getInvestmentAggregateOnlyTransactions(transactions = []) {
        return runtime.filterAggregateOnlyOverlayTransactions(
            transactions,
            runtime.state.investmentAggregateSecurityTransferState.excludedReceiptKeys,
            (transaction) => transaction?.manual_internal_transfer_key,
        );
    }

function isInvestmentAggregateSecurityTransferPnlUnavailable(ticker) {
        return runtime.state.investmentAggregateSecurityTransferState.pnlUnavailableTickers.has(
            runtime.getInvestmentCanonicalTicker(ticker),
        );
    }

function applyInvestmentAggregatePnlAvailability(tickerSummaries = []) {
        return (Array.isArray(tickerSummaries) ? tickerSummaries : []).map((summary) => {
            const pnlUnavailable = (
                summary?.pnlUnavailable === true
                || isInvestmentAggregateSecurityTransferPnlUnavailable(summary?.ticker)
            );
            if (!pnlUnavailable) return summary;
            const reconciliation = summary?.realizedPnlReconciliation;
            const unavailableReconciliation = reconciliation && typeof reconciliation === 'object'
                ? {
                    ...reconciliation,
                    coverageStatus: 'unavailable',
                    replay: reconciliation.replay && typeof reconciliation.replay === 'object'
                        ? {...reconciliation.replay, status: 'unavailable'}
                        : {status: 'unavailable', required: false},
                    realizedPnl: null,
                    realizedPnlLocal: null,
                    realizedPnlByDate: {},
                    realizedPnlByDateLocal: {},
                    arithmeticCheck: {
                        ...(reconciliation.arithmeticCheck || {}),
                        valid: false,
                    },
                }
                : reconciliation;
            return {
                ...summary,
                pnlUnavailable: true,
                pnlUnavailableReason: String(
                    summary?.pnlUnavailableReason
                    || getInvestmentSecurityTransferReconciliation()?.pnl_unavailable_reason
                    || 'cost_basis_unverified'
                ),
                realizedPnl: null,
                realizedPnlLocal: null,
                realizedPnlByDate: {},
                realizedPnlReconciliation: unavailableReconciliation,
                unrealizedPnl: null,
                unrealizedPnlLocal: null,
            };
        });
    }

    return {
        normalizeInvestmentView,
        stopInvestmentRealtimeQuotePolling,
        getInvestmentRealtimeQuoteEndpoint,
        getInvestmentMarketSessionEndpoint,
        getSafeInvestmentMarketSessionState,
        isInvestmentOverviewHighPrecisionEquityRange,
        getInvestmentOverviewIntradayDayCount,
        refreshInvestmentMarketSessionState,
        getCachedInvestmentMarketSessionState,
        shouldShowInvestmentRealtimePulse,
        getInvestmentNewYorkClockParts,
        getInvestmentRealtimeClockSession,
        shouldRunInvestmentRealtimeQuotes,
        isInvestmentOverviewIntradayEquityRange,
        isInvestmentDailyEquityLiveRange,
        getInvestmentLiveSessionDateKey,
        getInvestmentDailyEquityLiveSessionDateKey,
        findInvestmentChartPointIndexForLedgerDate,
        shouldPreferInvestmentChartPoint,
        dedupeInvestmentChartPointsByLedgerDate,
        ensureInvestmentLiveSessionChartSlot,
        getInvestmentEquityChartInputPoints,
        buildInvestmentAxisTickIndexes,
        buildInvestmentEquityTickIndexSet,
        getInvestmentRealtimeQuoteDateKey,
        isInvestmentHongKongTicker,
        getInvestmentQuoteMarket,
        getInvestmentHongKongClockParts,
        getInvestmentHongKongClockSession,
        shouldShowInvestmentHoldingLiveBadge,
        hasInvestmentHoldingLiveBadgeSession,
        shiftInvestmentCalendarDateKey,
        shouldUseInvestmentUsRealtimeQuote,
        shouldApplyInvestmentRealtimePriceForHoldings,
        shouldUseInvestmentHongKongRealtimeQuote,
        shouldUseInvestmentRealtimeQuote,
        portfolioHasOpenHongKongHoldings,
        getInvestmentRealtimeTickersFromSnapshot,
        requestInvestmentRealtimeQuotes,
        applyInvestmentSessionRealtimePrices,
        getInvestmentEmbeddedRealtimeQuotes,
        mergeInvestmentRealtimeQuotePayloads,
        bootstrapInvestmentSessionRealtimeQuotes,
        resetInvestmentRealtimeChartState,
        resetInvestmentRealtimeState,
        getInvestmentRealtimeOpenTickers,
        getInvestmentRealtimeHoldingsTickers,
        isInvestmentHoldingsRealtimeQuote,
        rememberInvestmentRealtimeQuotes,
        getInvestmentRealtimeQuoteForTicker,
        getInvestmentStockDetailsRealtimePulseTarget,
        buildInvestmentRealtimeTimestamp,
        buildInvestmentRealtimeChartPoints,
        applyInvestmentRealtimeQuotes,
        scheduleInvestmentRealtimeQuotePolling,
        pollInvestmentRealtimeQuotes,
        restartInvestmentRealtimeQuotePolling,
        readInvestmentPageMemory,
        writeInvestmentPageMemory,
        rememberInvestmentPageState,
        restoreRememberedInvestmentPageState,
        restoreRememberedInvestmentLocation,
        normalizeInvestmentInternalTransferBindings,
        normalizeInvestmentInternalTransferIgnoredSourceKeys,
        readInvestmentInternalTransferBindings,
        writeInvestmentInternalTransferBindings,
        readInvestmentInternalTransferIgnoredSourceKeys,
        writeInvestmentInternalTransferIgnoredSourceKeys,
        rememberInvestmentInternalTransferBinding,
        getInvestmentSecurityTransferReconciliation,
        applyInvestmentSecurityTransferBasisToTransactions,
        refreshInvestmentAggregateSecurityTransferState,
        getInvestmentAggregateSecurityTransferBlockedMessage,
        getInvestmentAggregateOnlyTransactions,
        isInvestmentAggregateSecurityTransferPnlUnavailable,
        applyInvestmentAggregatePnlAvailability,
    };
}

