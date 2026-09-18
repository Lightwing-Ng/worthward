/**
 * Holdings live values and Stock-details panel rendering.
 *
 * Code version: v1.1.1
 * - Fixed: Realtime Holdings delegates current NAV arithmetic to the shared
 *   total-equity calculation, preventing dated interest accrual double counting.
 * - Added: Current Holdings Total equity includes a reported broker
 *   interest accrual only when its as-of date is the current valuation date,
 *   matching the final daily chart point.
 * - Added: Extracted from the Investment workspace composition root.
 */

export function createInvestmentHoldingsLiveRuntime(runtime) {
function normalizeShareHoldingsMoneyText(value) {
        return String(value || '').replace(/([+-]?)\$\s*/g, '$1').trim();
    }

function resolveShareHoldingsMetricToneClass(displayText, element) {
        if (element instanceof HTMLElement) {
            if (element.classList.contains('investment-holdings-value-positive')) return ' investment-holdings-value-positive';
            if (element.classList.contains('investment-holdings-value-negative')) return ' investment-holdings-value-negative';
        }
        const normalized = String(displayText || '').trim();
        if (normalized.startsWith('+')) return ' investment-holdings-value-positive';
        if (normalized.startsWith('-') && normalized !== '-') return ' investment-holdings-value-negative';
        return '';
    }

function populateShareHoldingsMetricCell(cell) {
        if (!(cell instanceof HTMLTableCellElement)) return;
        const existingMetric = cell.querySelector('.trade-metric-value, .investment-live-value');
        const displayText = normalizeShareHoldingsMoneyText(
            (existingMetric instanceof HTMLElement
                ? (existingMetric.dataset.investmentLiveDisplay || existingMetric.textContent)
                : cell.textContent) || '',
        ).trim() || '-';
        const toneClass = resolveShareHoldingsMetricToneClass(displayText, existingMetric);
        cell.textContent = '';
        const metric = document.createElement('span');
        metric.className = `trade-metric-value investment-stock-details-metric-value investment-holdings-live-value${toneClass}`.trim();
        metric.innerHTML = runtime.renderWorkspaceMetricValueContent(displayText);
        cell.appendChild(metric);
    }

function formatHoldingsLocalMoney(value, currency) {
        if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
        const normalizedCurrency = String(currency || '').trim().toUpperCase();
        const baseCurrency = runtime.getInvestmentBaseCurrency();
        const formatted = runtime.formatHoldingsMoney(value);
        if (!normalizedCurrency || normalizedCurrency === baseCurrency) {
            return formatted;
        }
        return `${normalizedCurrency} ${formatted}`;
    }

function formatSignedHoldingsLocalMoney(value, currency) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) return '-';
        const formatted = formatHoldingsLocalMoney(Math.abs(numericValue), currency);
        if (formatted === '-') return formatted;
        return numericValue > 0 ? `+${formatted}` : (numericValue < 0 ? `-${formatted}` : formatted);
    }

function formatHoldingsLocalCurrencyLine(value, currency) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue) || Math.abs(numericValue) < 1e-9) return '';
        const normalizedCurrency = String(currency || '').trim().toUpperCase();
        const baseCurrency = runtime.getInvestmentBaseCurrency();
        if (!normalizedCurrency || normalizedCurrency === baseCurrency) return '';
        const sign = numericValue < 0 ? '-' : '';
        return `${normalizedCurrency} ${runtime.formatHoldingsMoney(Math.abs(numericValue))}`;
    }

function shouldShowHoldingsLocalCurrencyLine(localValue, currency) {
        const normalizedCurrency = String(currency || '').trim().toUpperCase();
        const baseCurrency = runtime.getInvestmentBaseCurrency();
        if (!normalizedCurrency || normalizedCurrency === baseCurrency) return false;
        const numericValue = Number(localValue);
        return Number.isFinite(numericValue) && Math.abs(numericValue) >= 1e-9;
    }

function renderHoldingsDualCurrencyValue(usdValue, localValue, currency, { valueClass = '' } = {}) {
        const usdDisplay = runtime.formatHoldingsMoney(usdValue);
        if (!shouldShowHoldingsLocalCurrencyLine(localValue, currency)) {
            return `<span class="trade-metric-value investment-stock-details-metric-value${valueClass}">${runtime.renderWorkspaceMetricValueContent(usdDisplay)}</span>`;
        }
        const localDisplay = formatHoldingsLocalCurrencyLine(localValue, currency);
        return `
            <span class="investment-holdings-dual-currency">
                <span class="trade-metric-value investment-stock-details-metric-value investment-holdings-dual-currency-primary${valueClass}">${runtime.renderWorkspaceMetricValueContent(usdDisplay)}</span>
                <span class="investment-holdings-dual-currency-secondary">${runtime.escapeHtml(localDisplay)}</span>
            </span>
        `;
    }

function renderInvestmentLiveValue(field, value, {
        ticker = '',
        formatter = (nextValue) => String(nextValue ?? '').trim() || '-',
        className = '',
        useSplitValue = false,
    } = {}) {
        const displayText = formatter(value);
        const numericValue = Number(value);
        const classToken = className ? ` ${className}` : '';
        const tickerAttr = ticker ? ` data-investment-live-ticker="${runtime.escapeHtml(ticker)}"` : '';
        const numberAttr = Number.isFinite(numericValue)
            ? ` data-investment-live-number="${runtime.escapeHtml(String(numericValue))}"`
            : '';
        const innerHtml = useSplitValue ? runtime.renderWorkspaceMetricValueContent(displayText) : runtime.escapeHtml(displayText);
        return `<span class="investment-live-value${classToken}" data-investment-live-field="${runtime.escapeHtml(field)}"${tickerAttr}${numberAttr} data-investment-live-display="${runtime.escapeHtml(displayText)}">${innerHtml}</span>`;
    }

function calculateHoldingsSummaryAllocation(value, totalEquity) {
        const numericValue = Number(value);
        const numericTotalEquity = Number(totalEquity);
        if (
            !Number.isFinite(numericValue)
            || !Number.isFinite(numericTotalEquity)
            || Math.abs(numericTotalEquity) <= runtime.INVESTMENT_LIVE_DIGIT_EPSILON
        ) {
            return null;
        }
        return (numericValue / numericTotalEquity) * 100;
    }

function getInvestmentHoldingsAllocationBadgeToneClass(toneValue) {
        const numericToneValue = Number(toneValue);
        if (!Number.isFinite(numericToneValue)) return '';
        return numericToneValue >= 0
            ? ' investment-holdings-allocation-badge-positive'
            : ' investment-holdings-allocation-badge-negative';
    }

function getInvestmentHoldingsDailyPnlBadgeToneClass(value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return '';
        }
        if (Math.abs(numericValue) < runtime.INVESTMENT_DAILY_PNL_DISPLAY_EPSILON) {
            return ' investment-holdings-daily-pnl-badge-neutral';
        }
        return numericValue > 0
            ? ' investment-holdings-daily-pnl-badge-positive'
            : ' investment-holdings-daily-pnl-badge-negative';
    }

function getInvestmentHoldingsRealizedToneClass(value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) return '';
        if (Math.abs(numericValue) < runtime.INVESTMENT_DAILY_PNL_DISPLAY_EPSILON) {
            return ' investment-holdings-value-neutral';
        }
        return numericValue > 0
            ? ' investment-holdings-value-positive'
            : ' investment-holdings-value-negative';
    }

function renderInvestmentHoldingsAllocationBadgeValueContent(displayText) {
        return runtime.getNumericDisplayParts(displayText)
            .map((part) => `<span class="${part.className}">${Array.from(part.text)
                .map((glyph) => `<span class="investment-holdings-allocation-badge-glyph">${runtime.escapeHtml(glyph)}</span>`)
                .join('')}</span>`)
            .join('');
    }

function renderInvestmentHoldingsDailyPnlBadge(
        field,
        ticker,
        value,
        {
            formatter = runtime.formatSignedHoldingsMoney,
            hideZeroValue = false,
            liveEligible = true,
            ariaLabel = '',
        } = {},
    ) {
        const numericValue = runtime.parseInvestmentOptionalNumber(value);
        const hasNumericValue = numericValue !== null;
        const isVisible = liveEligible && hasNumericValue && !(
            hideZeroValue && Math.abs(numericValue) < runtime.INVESTMENT_DAILY_PNL_DISPLAY_EPSILON
        );
        const displayText = hasNumericValue ? formatter(numericValue) : '-';
        const toneClass = hasNumericValue
            ? getInvestmentHoldingsDailyPnlBadgeToneClass(numericValue)
            : '';
        const accessibleLabel = String(ariaLabel || '').trim();
        const accessibilityAttributes = accessibleLabel
            ? ` aria-label="${runtime.escapeHtml(accessibleLabel)}" title="${runtime.escapeHtml(accessibleLabel)}"`
            : '';
        return `
            <span class="investment-holdings-daily-pnl-badge${toneClass}"${isVisible ? '' : ' hidden'}${accessibilityAttributes}>
                <span class="trade-metric-value investment-stock-details-metric-value investment-holdings-daily-pnl-badge-value"
                      data-investment-live-field="${runtime.escapeHtml(field)}"
                      data-investment-live-ticker="${runtime.escapeHtml(ticker)}"
                      data-investment-live-number="${runtime.escapeHtml(String(hasNumericValue ? numericValue : ''))}"
                      data-investment-live-display="${runtime.escapeHtml(displayText)}">${runtime.renderWorkspaceMetricValueContent(displayText)}</span>
            </span>
        `;
    }

function updateInvestmentHoldingsDailyPnlBadge(
        node,
        value,
        {
            formatter = runtime.formatSignedHoldingsMoney,
            hideZeroValue = false,
            liveEligible = true,
        } = {},
    ) {
        if (!(node instanceof HTMLElement)) return;
        const numericValue = runtime.parseInvestmentOptionalNumber(value);
        const hasNumericValue = numericValue !== null;
        const isVisible = liveEligible && hasNumericValue && !(
            hideZeroValue && Math.abs(numericValue) < runtime.INVESTMENT_DAILY_PNL_DISPLAY_EPSILON
        );
        const displayText = hasNumericValue ? formatter(numericValue) : '-';
        node.dataset.investmentLiveNumber = String(hasNumericValue ? numericValue : '');
        node.dataset.investmentLiveDisplay = displayText;
        node.innerHTML = runtime.renderWorkspaceMetricValueContent(displayText);
        const badge = node.closest('.investment-holdings-daily-pnl-badge');
        if (!(badge instanceof HTMLElement)) return;
        badge.hidden = !isVisible;
        badge.classList.toggle(
            'investment-holdings-daily-pnl-badge-neutral',
            isVisible && Math.abs(numericValue) < runtime.INVESTMENT_DAILY_PNL_DISPLAY_EPSILON,
        );
        badge.classList.toggle('investment-holdings-daily-pnl-badge-positive', isVisible && numericValue > 0);
        badge.classList.toggle('investment-holdings-daily-pnl-badge-negative', isVisible && numericValue < 0);
    }

function syncInvestmentHoldingsLiveBadgeVisibility() {
        const holdingRows = Array.from(document.querySelectorAll(
            '#investment_holdings_panel tr[data-investment-holdings-ticker]'
        ));
        holdingRows.forEach((row) => {
            if (!(row instanceof HTMLTableRowElement)) return;
            const liveEligible = runtime.shouldShowInvestmentHoldingLiveBadge(
                row.dataset.investmentHoldingsTicker,
            );
            for (const field of ['daily_last_price', 'daily_unrealized_pnl']) {
                const node = row.querySelector(`[data-investment-live-field="${field}"]`);
                if (!(node instanceof HTMLElement)) continue;
                const numericValue = runtime.parseInvestmentOptionalNumber(
                    node.dataset.investmentLiveNumber,
                );
                const badge = node.closest('.investment-holdings-daily-pnl-badge');
                if (badge instanceof HTMLElement) {
                    badge.hidden = !liveEligible || numericValue === null;
                }
            }
        });

        const summaryUnrealizedNode = document.querySelector(
            '#investment_holdings_panel [data-investment-live-field="summary_daily_unrealized_pnl"]'
        );
        if (summaryUnrealizedNode instanceof HTMLElement) {
            const numericValue = runtime.parseInvestmentOptionalNumber(
                summaryUnrealizedNode.dataset.investmentLiveNumber,
            );
            const badge = summaryUnrealizedNode.closest('.investment-holdings-daily-pnl-badge');
            if (badge instanceof HTMLElement) {
                badge.hidden = !runtime.hasInvestmentHoldingLiveBadgeSession()
                    || numericValue === null;
            }
        }
    }

function renderInvestmentHoldingsAllocationBadge(field, value, toneValue = value) {
        const numericValue = Number(value);
        const displayText = Number.isFinite(numericValue) ? runtime.formatHoldingsPercent(numericValue) : '-';
        const numberAttr = Number.isFinite(numericValue)
            ? ` data-investment-live-number="${runtime.escapeHtml(String(numericValue))}"`
            : '';
        const toneClass = getInvestmentHoldingsAllocationBadgeToneClass(toneValue);
        return `
            <span class="investment-holdings-allocation-badge${toneClass}">
                <span class="trade-metric-value investment-stock-details-metric-value investment-holdings-allocation-badge-value" data-investment-live-field="${runtime.escapeHtml(field)}"${numberAttr} data-investment-live-display="${runtime.escapeHtml(displayText)}">${renderInvestmentHoldingsAllocationBadgeValueContent(displayText)}</span>
            </span>
        `;
    }

function updateInvestmentHoldingsAllocationBadge(node, value, toneValue = value) {
        if (!(node instanceof HTMLElement)) return;
        const numericValue = Number(value);
        const displayText = Number.isFinite(numericValue) ? runtime.formatHoldingsPercent(numericValue) : '-';
        node.dataset.investmentLiveDisplay = displayText;
        if (Number.isFinite(numericValue)) {
            node.dataset.investmentLiveNumber = String(numericValue);
        } else {
            delete node.dataset.investmentLiveNumber;
        }
        const badge = node.closest('.investment-holdings-allocation-badge');
        if (badge instanceof HTMLElement) {
            const numericToneValue = Number(toneValue);
            const hasTone = Number.isFinite(numericToneValue);
            badge.classList.toggle(
                'investment-holdings-allocation-badge-positive',
                hasTone && numericToneValue >= 0,
            );
            badge.classList.toggle(
                'investment-holdings-allocation-badge-negative',
                hasTone && numericToneValue < 0,
            );
        }
        node.innerHTML = renderInvestmentHoldingsAllocationBadgeValueContent(displayText);
    }

function applyInvestmentCurrentTotalEquityToSummaryWeights(summaries, totalEquity) {
        const safeTotalEquity = Number(totalEquity);
        return (Array.isArray(summaries) ? summaries : []).map((summary) => {
            if (!summary?.hasOpenPosition) return summary;
            if (
                summary.marketValue === null
                || summary.marketValue === undefined
                || summary.marketValue === ''
            ) {
                return {...summary, positionWeight: null};
            }
            const marketValue = Number(summary.marketValue);
            return {
                ...summary,
                positionWeight: Number.isFinite(marketValue)
                    && Number.isFinite(safeTotalEquity)
                    && Math.abs(safeTotalEquity) > runtime.INVESTMENT_LIVE_DIGIT_EPSILON
                    ? (marketValue / safeTotalEquity) * 100
                    : null,
            };
        });
    }

function buildInvestmentCurrentEquityChartPoints(
        chartPoints,
        summaries,
        aggregateCash,
        totalEquity,
    ) {
        const sourcePoints = Array.isArray(chartPoints) ? chartPoints : [];
        const safeCash = Number(aggregateCash);
        if (totalEquity === null || totalEquity === undefined || totalEquity === '') {
            return sourcePoints;
        }
        const safeTotalEquity = Number(totalEquity);
        if (!sourcePoints.length || !Number.isFinite(safeCash) || !Number.isFinite(safeTotalEquity)) {
            return sourcePoints;
        }
        const openSummaries = (Array.isArray(summaries) ? summaries : [])
            .filter((summary) => summary?.hasOpenPosition);
        if (openSummaries.some((summary) => (
            summary?.marketValue === null
            || summary?.marketValue === undefined
            || summary?.marketValue === ''
            || !Number.isFinite(Number(summary.marketValue))
        ))) {
            return sourcePoints;
        }
        const holdingsMarketValues = Object.fromEntries(
            openSummaries
                .map((summary) => [
                    String(summary.ticker || '').trim().toUpperCase(),
                    Number(summary.marketValue),
                ])
                .filter(([ticker, value]) => ticker && Number.isFinite(value)),
        );
        const holdingsQuotePrices = Object.fromEntries(
            openSummaries
                .map((summary) => [
                    String(summary.ticker || '').trim().toUpperCase(),
                    Number(summary.lastPrice),
                ])
                .filter(([ticker, value]) => ticker && Number.isFinite(value) && value > 0),
        );
        const currentMarketValue = openSummaries.reduce(
            (sum, summary) => sum + Number(summary.marketValue),
            0,
        );
        const latestIndex = sourcePoints.length - 1;
        const latestPoint = sourcePoints[latestIndex];
        const currentPoint = {
            ...latestPoint,
            aggregate_display_cash: safeCash,
            aggregate_current_display_cash: safeCash,
            market_value: currentMarketValue,
            aggregate_market_value: currentMarketValue,
            holdings_market_values: holdingsMarketValues,
            aggregate_holdings_market_values: holdingsMarketValues,
            holdings_quote_prices: holdingsQuotePrices,
            aggregate_holdings_quote_prices: holdingsQuotePrices,
            total_equity: safeTotalEquity,
            aggregate_total_equity: safeTotalEquity,
            aggregate_current_total_equity: safeTotalEquity,
            valuation_complete: true,
        };
        return sourcePoints.map((point, index) => index === latestIndex ? currentPoint : point);
    }

function isInvestmentCurrentSnapshotDate(date) {
        const snapshotDate = runtime.normalizeLedgerDate(date);
        const todayDate = runtime.normalizeLedgerDate(runtime.getTodayLedgerDate());
        if (!snapshotDate || !todayDate) return false;
        const snapshotTime = Date.parse(`${snapshotDate}T00:00:00Z`);
        const todayTime = Date.parse(`${todayDate}T00:00:00Z`);
        if (!Number.isFinite(snapshotTime) || !Number.isFinite(todayTime)) return false;
        const ageInDays = (todayTime - snapshotTime) / (24 * 60 * 60 * 1000);
        return ageInDays >= 0 && ageInDays <= 3;
    }

function computeHoldingsCashEquivalents(summaries, aggregateCash) {
        if (aggregateCash === null || aggregateCash === undefined || aggregateCash === '') return null;
        const cash = Number(aggregateCash);
        if (!Number.isFinite(cash)) return null;
        const configuredTickers = runtime.getCashEquivalentTickerSet();
        const cashEquivalentMarketValue = (Array.isArray(summaries) ? summaries : [])
            .filter((summary) => (
                summary?.hasOpenPosition
                && configuredTickers.has(String(summary.ticker || '').trim().toUpperCase())
            ))
            .reduce((sum, summary) => sum + (Number.isFinite(summary.marketValue) ? summary.marketValue : NaN), 0);
        return Number.isFinite(cashEquivalentMarketValue) ? cash + cashEquivalentMarketValue : null;
    }

function resolveInvestmentTickerReferenceClose(ticker) {
        const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
        if (!normalizedTicker) return null;
        const tickerPriceIndex = runtime.buildTickerPriceIndex(runtime.state.investmentTickerClosePricesCache);
        const latestLedgerDate = runtime.normalizeLedgerDate(
            runtime.state.investmentProcessedTransactionsCache[runtime.state.investmentProcessedTransactionsCache.length - 1]?.date
        );
        const referenceClose = runtime.getIndexedClosePriceOnOrBefore(
            tickerPriceIndex[normalizedTicker],
            latestLedgerDate,
        );
        return Number.isFinite(Number(referenceClose)) ? Number(referenceClose) : null;
    }

function getInvestmentHoldingSessionDate(ticker) {
        const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
        if (!normalizedTicker) return runtime.getTodayLedgerDate();
        const quote = runtime.getInvestmentRealtimeQuoteForTicker(normalizedTicker);
        const quoteSessionDate = runtime.normalizeLedgerDate(quote?.session_date);
        if (quoteSessionDate) return quoteSessionDate;
        const market = runtime.getInvestmentQuoteMarket(quote, normalizedTicker);
        if (market === 'HK') return runtime.getInvestmentHongKongClockParts().dateKey;
        if (market === 'US') {
            const marketSessionDate = runtime.normalizeLedgerDate(
                runtime.getCachedInvestmentMarketSessionState()?.session_date,
            );
            return marketSessionDate || runtime.getInvestmentNewYorkClockParts().dateKey;
        }
        return runtime.getTodayLedgerDate();
    }

function resolveInvestmentTickerPreviousClose(ticker, sessionDate) {
        const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
        const normalizedSessionDate = runtime.normalizeLedgerDate(sessionDate);
        if (!normalizedTicker || !normalizedSessionDate) return null;
        const tickerPriceIndex = runtime.buildTickerPriceIndex(runtime.state.investmentTickerClosePricesCache);
        const priceRecord = tickerPriceIndex[normalizedTicker];
        if (!priceRecord) return null;
        const priorDates = priceRecord.dates.filter((date) => date < normalizedSessionDate);
        if (!priorDates.length) return null;
        const previousClose = Number(priceRecord.closes[priorDates[priorDates.length - 1]]);
        return Number.isFinite(previousClose) && previousClose > 0 ? previousClose : null;
    }

function resolveInvestmentHoldingDailyPnl(summary) {
        if (!summary?.hasOpenPosition) {
            return { realized: 0, unrealized: 0 };
        }
        const sessionDate = getInvestmentHoldingSessionDate(summary.ticker);
        const reconciliation = summary?.realizedPnlReconciliation;
        const realizedPnlByDate = (
            reconciliation
            && Object.prototype.hasOwnProperty.call(reconciliation, 'realizedPnlByDate')
        ) ? reconciliation.realizedPnlByDate : summary.realizedPnlByDate;
        const realized = Number(realizedPnlByDate?.[sessionDate]) || 0;
        const lastPrice = runtime.getOptionalInvestmentNumber(summary.lastPrice);
        const shares = runtime.getOptionalInvestmentNumber(summary.shares);
        const previousClose = resolveInvestmentTickerPreviousClose(summary.ticker, sessionDate);
        if (
            lastPrice === null
            || shares === null
            || !Number.isFinite(previousClose)
        ) {
            return { realized, unrealized: null };
        }
        const dailyUnrealizedLocal = (lastPrice - previousClose) * shares;
        const fxTimeline = runtime.buildInvestmentFxRateTimeline(
            runtime.state.investmentRawTransactionsCache,
            runtime.getInvestmentBaseCurrency(),
        );
        const unrealized = runtime.convertAmountToBaseCurrency(
            dailyUnrealizedLocal,
            summary.quoteCurrency,
            sessionDate,
            fxTimeline,
            runtime.getInvestmentBaseCurrency(),
        );
        return {
            realized,
            unrealized: Number.isFinite(unrealized) ? unrealized : null,
        };
    }

function resolveInvestmentHoldingDailyPriceChange(summary) {
        if (!summary?.hasOpenPosition) return null;
        const sessionDate = getInvestmentHoldingSessionDate(summary.ticker);
        const lastPrice = runtime.getOptionalInvestmentNumber(summary.lastPrice);
        const previousClose = resolveInvestmentTickerPreviousClose(summary.ticker, sessionDate);
        if (lastPrice === null || !Number.isFinite(previousClose)) return null;
        return lastPrice - previousClose;
    }

function resolveInvestmentLastPriceToneClass(lastPrice, ticker) {
        const price = Number(lastPrice);
        const referenceClose = resolveInvestmentTickerReferenceClose(ticker);
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(referenceClose)) return '';
        if (price > referenceClose + runtime.INVESTMENT_LIVE_DIGIT_EPSILON) return ' investment-holdings-value-positive';
        if (price < referenceClose - runtime.INVESTMENT_LIVE_DIGIT_EPSILON) return ' investment-holdings-value-negative';
        return '';
    }

function getInvestmentHoldingsRealtimeState() {
        if (runtime.state.investmentAggregateSecurityTransferState.blocked) {
            return null;
        }
        if (!Array.isArray(runtime.state.investmentRawTransactionsCache) || !runtime.state.investmentRawTransactionsCache.length) {
            return null;
        }
        const aggregateTransactions = runtime.getInvestmentAggregateOnlyTransactions(
            runtime.state.investmentRawTransactionsCache,
        );
        const latestSnapshot = runtime.state.investmentProcessedTransactionsCache[runtime.state.investmentProcessedTransactionsCache.length - 1];
        const rawAggregateCash = Number(latestSnapshot?.aggregate_display_cash);
        const aggregateCash = Number.isFinite(rawAggregateCash)
            ? rawAggregateCash
            : Number(latestSnapshot?.aggregate_running_cash ?? latestSnapshot?.running_cash);
        const latestChartPoint = Array.isArray(runtime.state.investmentChartPointsCache) && runtime.state.investmentChartPointsCache.length
            ? runtime.state.investmentChartPointsCache[runtime.state.investmentChartPointsCache.length - 1]
            : null;
        const realtimeChartPoint = Array.isArray(runtime.state.investmentChartPointsCache)
            ? runtime.state.investmentChartPointsCache.find((point) => point?.is_realtime === true)
            : null;
        const preliminaryRealtimeEquity = Number(
            realtimeChartPoint?.aggregate_total_equity ?? realtimeChartPoint?.total_equity
        );
        const preliminaryChartEquity = Number(
            latestChartPoint?.aggregate_total_equity ?? latestChartPoint?.total_equity
        );
        const preliminaryTotalEquity = Number.isFinite(preliminaryRealtimeEquity)
            ? preliminaryRealtimeEquity
            : preliminaryChartEquity;
        const safeTotalEquity = Number.isFinite(preliminaryTotalEquity) ? preliminaryTotalEquity : 0;
        const valuationDate = runtime.normalizeLedgerDate(latestChartPoint?.date)
            || runtime.normalizeLedgerDate(runtime.state.investmentProcessedTransactionsCache[runtime.state.investmentProcessedTransactionsCache.length - 1]?.date)
            || '';
        const baseCurrency = runtime.getInvestmentBaseCurrency();
        const fxTimeline = runtime.buildInvestmentFxRateTimeline(aggregateTransactions, baseCurrency);
        const summaries = runtime.applyInvestmentAggregatePnlAvailability(
            runtime.buildTickerSummaries(
                aggregateTransactions,
                runtime.state.investmentLatestPricesCache,
                safeTotalEquity,
                runtime.state.investmentTickerClosePricesCache,
            ),
        ).map((summary) => {
            const nextSummary = { ...summary };
            const livePrice = Number(runtime.state.investmentLatestPricesCache[nextSummary.ticker]);
            if (Number.isFinite(livePrice) && livePrice > 0) {
                nextSummary.lastPrice = livePrice;
            }
            if (nextSummary.pnlUnavailable) {
                return nextSummary;
            }
            if (!nextSummary.hasOpenPosition || !Number.isFinite(livePrice) || livePrice <= 0) {
                return nextSummary;
            }
            const quoteCurrency = runtime.getTickerQuoteCurrency(nextSummary.ticker);
            const marketValueLocal = Number(nextSummary.shares) * livePrice;
            const unrealizedPnlLocal = nextSummary.averagePrice === null
                ? null
                : (
                    Number(nextSummary.shares) >= 0
                        ? (livePrice - nextSummary.averagePrice) * Number(nextSummary.shares)
                        : (nextSummary.averagePrice - livePrice) * Math.abs(Number(nextSummary.shares))
                );
            const marketValue = runtime.convertAmountToBaseCurrency(
                marketValueLocal,
                quoteCurrency,
                valuationDate,
                fxTimeline,
                baseCurrency,
            );
            const unrealizedPnl = unrealizedPnlLocal === null
                ? null
                : runtime.convertAmountToBaseCurrency(
                    unrealizedPnlLocal,
                    quoteCurrency,
                    valuationDate,
                    fxTimeline,
                    baseCurrency,
                );
            nextSummary.marketValue = marketValue;
            nextSummary.unrealizedPnl = unrealizedPnl;
            nextSummary.positionWeight = Number.isFinite(safeTotalEquity)
                && Number.isFinite(marketValue)
                && Math.abs(safeTotalEquity) > runtime.INVESTMENT_LIVE_DIGIT_EPSILON
                ? (marketValue / safeTotalEquity) * 100
                : null;
            return nextSummary;
        });
        // A dated accrual is authoritative only on its own as-of date; it is
        // never cash and is not carried to a later valuation date.
        const interestAccrual = runtime.getInvestmentInterestAccrualOnDate(valuationDate, {
            brokerCodes: new Set(aggregateTransactions.map((txn) => (
                runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn))
            ))),
            fxTimeline,
            baseCurrency,
        });
        const resolvedTotalEquity = runtime.computeInvestmentCurrentHoldingsTotalEquity(
            summaries,
            aggregateCash,
            interestAccrual,
        );
        if (Math.abs(resolvedTotalEquity - safeTotalEquity) > runtime.INVESTMENT_LIVE_DIGIT_EPSILON) {
            summaries.forEach((summary) => {
                if (!summary?.hasOpenPosition) return;
                summary.positionWeight = Number.isFinite(summary.marketValue)
                    && Math.abs(resolvedTotalEquity) > runtime.INVESTMENT_LIVE_DIGIT_EPSILON
                    ? (summary.marketValue / resolvedTotalEquity) * 100
                    : null;
            });
        }
        return {
            summaries,
            totalEquity: resolvedTotalEquity,
            aggregateCash: Number.isFinite(aggregateCash) ? aggregateCash : null,
            cashIsApproximate: latestSnapshot?.aggregate_current_cash_is_approximate === true,
        };
    }

function syncInvestmentHoldingsRealtimeValues() {
        const realtimeState = getInvestmentHoldingsRealtimeState();
        if (!realtimeState) return;
        const {
            summaries,
            totalEquity,
            aggregateCash,
            cashIsApproximate,
        } = realtimeState;
        runtime.state.investmentTickerSummariesCache = Array.isArray(summaries) ? [...summaries] : [];

        summaries.forEach((summary) => {
            const rows = document.querySelectorAll(
                `#investment_holdings_panel tr[data-investment-holdings-ticker="${CSS.escape(summary.ticker)}"]`
            );
            rows.forEach((row) => {
                if (!(row instanceof HTMLTableRowElement)) return;
                const lastNode = row.querySelector('[data-investment-live-field="last"]');
                const marketValueNode = row.querySelector('[data-investment-live-field="market_value"]');
                const unrealizedNode = row.querySelector('[data-investment-live-field="unrealized_pnl"]');
                const dailyLastPriceNode = row.querySelector('[data-investment-live-field="daily_last_price"]');
                const dailyRealizedNode = row.querySelector('[data-investment-live-field="daily_realized_pnl"]');
                const dailyUnrealizedNode = row.querySelector('[data-investment-live-field="daily_unrealized_pnl"]');
                const weightNode = row.querySelector('[data-investment-live-field="position_weight"]');
                const lastCell = lastNode?.closest('td');
                const unrealizedCell = unrealizedNode?.closest('td');
                const previousLastPrice = Number(lastNode?.dataset.investmentLiveNumber);

                runtime.updateInvestmentLiveValueNode(
                    lastNode,
                    formatHoldingsLocalMoney(summary.lastPrice, summary.quoteCurrency),
                    summary.lastPrice,
                );
                runtime.updateInvestmentLiveValueNode(
                    marketValueNode,
                    summary.hasOpenPosition ? runtime.formatHoldingsMoney(summary.marketValue) : '-',
                    summary.hasOpenPosition ? summary.marketValue : null,
                );
                if (!summary.pnlUnavailable) {
                    runtime.updateInvestmentLiveValueNode(
                        unrealizedNode,
                        summary.unrealizedPnl === null ? '-' : runtime.formatHoldingsMoney(summary.unrealizedPnl),
                        summary.unrealizedPnl,
                    );
                }
                updateInvestmentHoldingsDailyPnlBadge(
                    dailyLastPriceNode,
                    resolveInvestmentHoldingDailyPriceChange(summary),
                    {
                        formatter: (nextValue) => formatSignedHoldingsLocalMoney(
                            nextValue,
                            summary.quoteCurrency,
                        ),
                        liveEligible: runtime.shouldShowInvestmentHoldingLiveBadge(summary.ticker),
                    },
                );
                updateInvestmentHoldingsDailyPnlBadge(
                    dailyRealizedNode,
                    resolveInvestmentHoldingDailyPnl(summary).realized,
                    { hideZeroValue: true },
                );
                if (!summary.pnlUnavailable) {
                    updateInvestmentHoldingsDailyPnlBadge(
                        dailyUnrealizedNode,
                        resolveInvestmentHoldingDailyPnl(summary).unrealized,
                        { liveEligible: runtime.shouldShowInvestmentHoldingLiveBadge(summary.ticker) },
                    );
                }
                runtime.updateInvestmentLiveValueNode(
                    weightNode,
                    summary.hasOpenPosition ? runtime.formatHoldingsPercent(summary.positionWeight) : '-',
                    summary.hasOpenPosition ? summary.positionWeight : null,
                );
                runtime.syncInvestmentLiveDirectionTone([lastNode, lastCell], previousLastPrice, summary.lastPrice);
                if (!summary.pnlUnavailable) {
                    runtime.syncInvestmentLiveTone([unrealizedNode, unrealizedCell], summary.unrealizedPnl, {
                        enableSignedTone: summary.unrealizedPnl !== null,
                    });
                }
            });
        });

        const openSummaries = summaries.filter((summary) => summary.hasOpenPosition);
        const aggregateTransactions = runtime.getInvestmentAggregateOnlyTransactions(
            runtime.state.investmentRawTransactionsCache,
        );
        const brokerBenefitMetrics = runtime.getBrokerBenefitMetrics(
            aggregateTransactions,
            runtime.state.investmentLatestPricesCache,
            totalEquity,
        );
        const realizedAttribution = runtime.getRealizedPnlAttribution(
            aggregateTransactions,
            summaries,
            brokerBenefitMetrics,
        );
        const hasPnlUnavailable = runtime.isInvestmentAggregatePnlUnavailable(summaries)
            || !Number.isFinite(realizedAttribution.totalRealizedPnl);
        const totalRealizedPnl = hasPnlUnavailable ? null : realizedAttribution.totalRealizedPnl;
        const totalUnrealizedPnl = hasPnlUnavailable
            ? null
            : summaries.reduce((sum, summary) => sum + (Number(summary.unrealizedPnl) || 0), 0);
        const totalDailyPnl = hasPnlUnavailable ? null : summaries.reduce((totals, summary) => {
            if (summary?.pnlUnavailable === true) return totals;
            const dailyPnl = resolveInvestmentHoldingDailyPnl(summary);
            totals.realized += Number(dailyPnl.realized) || 0;
            if (dailyPnl.unrealized === null || dailyPnl.unrealized === undefined) {
                totals.unrealized = null;
            } else if (totals.unrealized !== null) {
                totals.unrealized += Number(dailyPnl.unrealized) || 0;
            }
            return totals;
        }, { realized: 0, unrealized: 0 });
        const cumulativePnl = hasPnlUnavailable ? null : totalRealizedPnl + totalUnrealizedPnl;
        runtime.setInvestmentCurrentChartPnlMetrics(
            hasPnlUnavailable ? null : totalRealizedPnl,
            hasPnlUnavailable ? null : totalUnrealizedPnl,
        );
        const totalNetMarketValue = openSummaries.reduce((sum, summary) => sum + (Number.isFinite(summary.marketValue) ? summary.marketValue : NaN), 0);
        const hasUnavailableOpenMarketValue = openSummaries.some(
            (summary) => !Number.isFinite(summary.marketValue),
        );
        const totalWeight = Number.isFinite(totalEquity)
            && !hasUnavailableOpenMarketValue
            && Math.abs(totalEquity) > runtime.INVESTMENT_LIVE_DIGIT_EPSILON
            ? (totalNetMarketValue / totalEquity) * 100
            : null;
        const cashEquivalents = computeHoldingsCashEquivalents(summaries, aggregateCash);

        const cashNode = document.querySelector('#investment_holdings_panel [data-investment-live-field="summary_cash_balance"]');
        const cashEquivalentsNode = document.querySelector('#investment_holdings_panel [data-investment-live-field="summary_cash_equivalents"]');
        const summaryMarketValueNode = document.querySelector('#investment_holdings_panel [data-investment-live-field="summary_market_value"]');
        const totalEquityNode = document.querySelector('#investment_holdings_panel [data-investment-live-field="summary_total_equity"]');
        const cashAllocationNode = document.querySelector('#investment_holdings_panel [data-investment-live-field="summary_cash_allocation"]');
        const cashEquivalentsAllocationNode = document.querySelector('#investment_holdings_panel [data-investment-live-field="summary_cash_equivalents_allocation"]');
        const cumulativeNode = document.querySelector('#investment_holdings_panel [data-investment-live-field="summary_cumulative_pnl"]');
        const summaryUnrealizedNode = document.querySelector('#investment_holdings_panel [data-investment-live-field="summary_unrealized_pnl"]');
        const summaryDailyRealizedNode = document.querySelector('#investment_holdings_panel [data-investment-live-field="summary_daily_realized_pnl"]');
        const summaryDailyUnrealizedNode = document.querySelector('#investment_holdings_panel [data-investment-live-field="summary_daily_unrealized_pnl"]');
        const summaryWeightNode = document.querySelector('#investment_holdings_panel [data-investment-live-field="summary_position_weight"]');
        const summaryUnrealizedCell = summaryUnrealizedNode?.closest('td');

        runtime.updateInvestmentLiveValueNode(
            cashNode,
            runtime.formatInvestmentCurrentCash(aggregateCash, cashIsApproximate),
            aggregateCash,
        );
        runtime.updateInvestmentLiveValueNode(
            cashEquivalentsNode,
            cashEquivalents === null ? '-' : runtime.formatHoldingsMoney(cashEquivalents),
            cashEquivalents,
        );
        runtime.updateInvestmentLiveValueNode(
            summaryMarketValueNode,
            runtime.formatHoldingsMoney(totalNetMarketValue),
            totalNetMarketValue,
        );
        runtime.updateInvestmentLiveValueNode(
            totalEquityNode,
            totalEquity === null ? '-' : runtime.formatHoldingsMoney(totalEquity),
            totalEquity,
        );
        updateInvestmentHoldingsAllocationBadge(
            cashAllocationNode,
            calculateHoldingsSummaryAllocation(aggregateCash, totalEquity),
            aggregateCash,
        );
        updateInvestmentHoldingsAllocationBadge(
            cashEquivalentsAllocationNode,
            calculateHoldingsSummaryAllocation(cashEquivalents, totalEquity),
            cashEquivalents,
        );
        runtime.syncInvestmentLiveTone(cashNode, aggregateCash, { enableSignedTone: aggregateCash !== null });
        runtime.syncInvestmentLiveTone(cashEquivalentsNode, cashEquivalents, { enableSignedTone: cashEquivalents !== null });
        runtime.syncInvestmentLiveTone(totalEquityNode, totalEquity, { enableSignedTone: totalEquity !== null });
        const metricsCashNode = document.querySelector('#investment_metrics_panel [data-investment-live-field="metrics_cash"]');
        const metricsMarketValueNode = document.querySelector('#investment_metrics_panel [data-investment-live-field="metrics_market_value"]');
        const metricsTotalEquityNode = document.querySelector('#investment_metrics_panel [data-investment-live-field="metrics_total_equity"]');
        const metricsCashTrigger = metricsCashNode?.closest('.investment-metric-tooltip-trigger');
        const metricsMarketValueTrigger = metricsMarketValueNode?.closest('.investment-metric-tooltip-trigger');
        const metricsTotalEquityTrigger = metricsTotalEquityNode?.closest('.investment-metric-tooltip-trigger');
        if (runtime.getInvestmentBrokerSummarySelectedCode() === 'all') {
            const liveMarketValue = hasUnavailableOpenMarketValue ? null : totalNetMarketValue;
            runtime.updateInvestmentLiveValueNode(
                metricsCashNode,
                runtime.formatInvestmentCurrentCash(aggregateCash, cashIsApproximate),
                aggregateCash,
            );
            runtime.updateInvestmentLiveValueNode(
                metricsMarketValueNode,
                liveMarketValue === null ? '-' : runtime.formatHoldingsMoney(liveMarketValue),
                liveMarketValue,
            );
            runtime.updateInvestmentLiveValueNode(
                metricsTotalEquityNode,
                totalEquity === null ? '-' : runtime.formatHoldingsMoney(totalEquity),
                totalEquity,
            );
            runtime.syncInvestmentLiveTone(metricsCashNode, aggregateCash, { enableSignedTone: aggregateCash !== null });
            runtime.syncInvestmentLiveTone(metricsMarketValueNode, liveMarketValue, { enableSignedTone: liveMarketValue !== null });
            runtime.syncInvestmentLiveTone(metricsTotalEquityNode, totalEquity, { enableSignedTone: totalEquity !== null });
            runtime.syncInvestmentLiveTone(metricsCashTrigger, aggregateCash, { enableSignedTone: aggregateCash !== null });
            runtime.syncInvestmentLiveTone(metricsMarketValueTrigger, liveMarketValue, { enableSignedTone: liveMarketValue !== null });
            runtime.syncInvestmentLiveTone(metricsTotalEquityTrigger, totalEquity, { enableSignedTone: totalEquity !== null });
        }
        const metricsCumulativeNode = document.querySelector('#investment_metrics_panel [data-investment-live-field="metrics_cumulative_pnl"]');
        const metricsUnrealizedNode = document.querySelector('#investment_metrics_panel [data-investment-live-field="metrics_unrealized_pnl"]');
        const metricsCumulativeTrigger = metricsCumulativeNode?.closest('.investment-metric-tooltip-trigger');
        const metricsUnrealizedTrigger = metricsUnrealizedNode?.closest('.investment-metric-tooltip-trigger');

        if (!hasPnlUnavailable) {
            runtime.updateInvestmentLiveValueNode(cumulativeNode, runtime.formatSignedHoldingsMoney(cumulativePnl), cumulativePnl);
            runtime.updateInvestmentLiveValueNode(summaryUnrealizedNode, runtime.formatHoldingsMoney(totalUnrealizedPnl), totalUnrealizedPnl);
            updateInvestmentHoldingsDailyPnlBadge(
                summaryDailyRealizedNode,
                totalDailyPnl.realized,
                { hideZeroValue: true },
            );
            updateInvestmentHoldingsDailyPnlBadge(
                summaryDailyUnrealizedNode,
                totalDailyPnl.unrealized,
                { liveEligible: runtime.hasInvestmentHoldingLiveBadgeSession(summaries) },
            );
        }
        runtime.updateInvestmentLiveValueNode(summaryWeightNode, runtime.formatHoldingsPercent(totalWeight), totalWeight);
        if (!hasPnlUnavailable) {
            runtime.updateInvestmentLiveValueNode(metricsCumulativeNode, runtime.formatSignedHoldingsMoney(cumulativePnl), cumulativePnl);
            runtime.updateInvestmentLiveValueNode(metricsUnrealizedNode, runtime.formatSignedHoldingsMoney(totalUnrealizedPnl), totalUnrealizedPnl);
            runtime.syncInvestmentLiveTone(cumulativeNode, cumulativePnl, { enableSignedTone: true });
            runtime.syncInvestmentLiveTone([summaryUnrealizedNode, summaryUnrealizedCell], totalUnrealizedPnl, { enableSignedTone: true });
            runtime.syncInvestmentLiveTone([metricsCumulativeNode, metricsCumulativeTrigger], cumulativePnl, { enableSignedTone: true });
            runtime.syncInvestmentLiveTone([metricsUnrealizedNode, metricsUnrealizedTrigger], totalUnrealizedPnl, { enableSignedTone: true });
        }
        syncInvestmentStockDetailsRealtimeMetrics();
        if (runtime.state.activeInvestmentView === 'metrics') {
            runtime.renderInvestmentMetricsPanel();
        }
    }

function syncInvestmentStockDetailsLivePulse() {
        if (!(runtime.investmentStockDetailsPanel instanceof HTMLElement)) return;
        const metrics = runtime.investmentStockDetailsPanel.querySelector('.investment-stock-details-metrics');
        if (metrics instanceof HTMLElement) {
            // Realtime eligibility belongs to the chart marker, never to metric-card chrome.
            // Price-derived values communicate direction through their digit-roll animation.
            metrics.classList.remove('is-investment-realtime-pulse');
        }
        const chartCanvas = runtime.state.investmentStockDetailsPriceChartInstance?.canvas;
        if (typeof chartCanvas?._syncInvestmentStockDetailsRealtimePulse === 'function') {
            chartCanvas._syncInvestmentStockDetailsRealtimePulse();
        }
    }

function syncInvestmentStockDetailsRealtimeMetrics() {
        if (!(runtime.investmentStockDetailsPanel instanceof HTMLElement)) return;
        const activeTicker = runtime.normalizeInvestmentTicker(runtime.state.selectedInvestmentStockTicker || '');
        if (!activeTicker || runtime.state.activeInvestmentView !== 'stock_details') {
            syncInvestmentStockDetailsLivePulse();
            return;
        }
        const tickerSummary = runtime.state.investmentTickerSummariesCache.find((summary) => (
            runtime.normalizeInvestmentTicker(summary?.ticker) === activeTicker
        ));
        if (!tickerSummary) return;

        const pnlUnavailable = tickerSummary?.pnlUnavailable === true;
        const totalPnl = pnlUnavailable
            ? null
            : (Number(tickerSummary.realizedPnl) || 0) + (Number(tickerSummary.unrealizedPnl) || 0);
        const updates = [
            {
                field: 'stock_unrealized_pnl',
                display: pnlUnavailable ? 'Unavailable' : (tickerSummary.unrealizedPnl === null ? '-' : runtime.formatHoldingsMoney(tickerSummary.unrealizedPnl)),
                value: pnlUnavailable ? null : tickerSummary.unrealizedPnl,
                signedTone: !pnlUnavailable,
            },
            {
                field: 'stock_total_pnl',
                display: pnlUnavailable ? 'Unavailable' : runtime.formatHoldingsMoney(totalPnl),
                value: totalPnl,
                signedTone: !pnlUnavailable,
            },
            {
                field: 'stock_market_value',
                display: tickerSummary.hasOpenPosition ? runtime.formatHoldingsMoney(tickerSummary.marketValue) : '-',
                value: tickerSummary.hasOpenPosition ? tickerSummary.marketValue : null,
                signedTone: false,
            },
            {
                field: 'stock_last_price',
                display: tickerSummary.lastPrice === null ? '-' : runtime.formatHoldingsMoney(tickerSummary.lastPrice),
                value: tickerSummary.lastPrice,
                signedTone: false,
                directionTone: true,
            },
            {
                field: 'stock_position_weight',
                display: tickerSummary.hasOpenPosition ? runtime.formatHoldingsPercent(tickerSummary.positionWeight) : '-',
                value: tickerSummary.hasOpenPosition ? tickerSummary.positionWeight : null,
                signedTone: false,
            },
        ];

        updates.forEach((update) => {
            const node = runtime.investmentStockDetailsPanel.querySelector(
                `[data-investment-live-field="${CSS.escape(update.field)}"][data-investment-live-ticker="${CSS.escape(activeTicker)}"]`
            );
            const previousValue = Number(node?.dataset.investmentLiveNumber);
            runtime.updateInvestmentLiveValueNode(node, update.display, update.value);
            if (update.signedTone) {
                runtime.syncInvestmentLiveTone(node, update.value, { enableSignedTone: Number.isFinite(Number(update.value)) });
            }
            if (update.directionTone) {
                runtime.syncInvestmentLiveDirectionTone(node, previousValue, update.value);
            }
        });
        syncInvestmentStockDetailsLivePulse();
    }

function renderInvestmentStockDetailsMetricValueSpan(value, valueClass = '') {
        const className = [
            'trade-metric-value',
            'investment-stock-details-metric-value',
            valueClass,
        ].filter(Boolean).join(' ');
        return `<span class="${className}">${runtime.renderWorkspaceMetricValueContent(value)}</span>`;
    }

function renderInvestmentStockDetailsLiveMetricValueSpan(metric, activeTicker) {
        const className = [
            'investment-live-value',
            'trade-metric-value',
            'investment-stock-details-metric-value',
            metric?.valueClass || '',
        ].filter(Boolean).join(' ');
        const display = metric?.value || '-';
        const numeric = metric?.liveNumber;
        const numberAttr = Number.isFinite(Number(numeric))
            ? ` data-investment-live-number="${runtime.escapeHtml(String(numeric))}"`
            : '';
        const tickerAttr = activeTicker ? ` data-investment-live-ticker="${runtime.escapeHtml(activeTicker)}"` : '';
        return `<span class="${className}" data-investment-live-field="${runtime.escapeHtml(metric?.liveField || '')}"${tickerAttr}${numberAttr} data-investment-live-display="${runtime.escapeHtml(display)}">${runtime.renderWorkspaceMetricValueContent(display)}</span>`;
    }

function renderInvestmentStockDetailsMetricCard(metric, metricIndex, activeTicker) {
        const details = Array.isArray(metric?.details) ? metric.details : [];
        const hasBreakdown = details.length > 0;
        const metricLabel = String(metric?.label || 'Metric');
        const breakdownId = `investment_stock_details_metric_breakdown_${metricIndex}`;
        const cardClassName = [
            'trade-metric-card',
            'trade-metric-card--value-align-end',
            'investment-stock-details-metric-card',
            metric?.cardClass || '',
            hasBreakdown ? 'investment-stock-details-metric-card-with-breakdown' : '',
        ].filter(Boolean).join(' ');
        const valueMarkup = metric?.liveField
            ? renderInvestmentStockDetailsLiveMetricValueSpan(metric, activeTicker)
            : renderInvestmentStockDetailsMetricValueSpan(metric?.value, metric?.valueClass);
        const valueRowMarkup = hasBreakdown
            ? `
                <div class="investment-stock-details-metric-value-row">
                    <button type="button"
                            class="investment-stock-details-metric-breakdown-trigger"
                            data-investment-stock-details-metric-breakdown-trigger
                            data-investment-stock-details-metric-label="${runtime.escapeHtml(metricLabel)}"
                            aria-controls="${breakdownId}"
                            aria-expanded="false"
                            aria-label="Show ${runtime.escapeHtml(metricLabel)} details"></button>
                    ${valueMarkup}
                </div>
            `
            : valueMarkup;
        const breakdownMarkup = hasBreakdown
            ? `
                <div id="${breakdownId}"
                     class="investment-stock-details-metric-breakdown"
                     role="region"
                     aria-label="${runtime.escapeHtml(metricLabel)} details"
                     hidden>
                    ${details.map((detail) => `
                        <div class="investment-stock-details-metric-breakdown-row">
                            <span class="investment-stock-details-metric-breakdown-label">${runtime.escapeHtml(detail.label)}</span>
                            <span class="investment-stock-details-metric-breakdown-value${detail.valueClass ? ` ${detail.valueClass}` : ''}">${runtime.renderWorkspaceMetricValueContent(detail.value)}</span>
                        </div>
                    `).join('')}
                </div>
            `
            : '';

        return `
            <div class="${cardClassName}">
                <span class="trade-metric-label">${runtime.escapeHtml(metricLabel)}</span>
                ${valueRowMarkup}
                ${breakdownMarkup}
            </div>
        `;
    }

function bindInvestmentStockDetailsMetricBreakdownControls() {
        if (!(runtime.investmentStockDetailsPanel instanceof HTMLElement)) return;
        if (runtime.investmentStockDetailsPanel.dataset.investmentMetricBreakdownBound === '1') return;
        runtime.investmentStockDetailsPanel.dataset.investmentMetricBreakdownBound = '1';
        runtime.investmentStockDetailsPanel.addEventListener('click', (event) => {
            const trigger = event.target instanceof Element
                ? event.target.closest('[data-investment-stock-details-metric-breakdown-trigger]')
                : null;
            if (!(trigger instanceof HTMLButtonElement) || !runtime.investmentStockDetailsPanel.contains(trigger)) return;
            const breakdownId = String(trigger.getAttribute('aria-controls') || '').trim();
            const breakdown = breakdownId ? document.getElementById(breakdownId) : null;
            if (!(breakdown instanceof HTMLElement) || !runtime.investmentStockDetailsPanel.contains(breakdown)) return;
            const shouldExpand = trigger.getAttribute('aria-expanded') !== 'true';
            const metricLabel = String(trigger.dataset.investmentStockDetailsMetricLabel || 'Metric');
            trigger.setAttribute('aria-expanded', String(shouldExpand));
            trigger.setAttribute('aria-label', `${shouldExpand ? 'Hide' : 'Show'} ${metricLabel} details`);
            breakdown.hidden = !shouldExpand;
            runtime.scheduleInvestmentStockDetailsVisibleLayoutSync();
        });
    }

function renderInvestmentStockDetailsPanel(tickerProfiles = {}) {
        if (!(runtime.investmentStockDetailsPanel instanceof HTMLElement)) return;
        if (runtime.investmentStockDetailsTableHost instanceof HTMLElement) {
            runtime.closeInvestmentStockDetailsTimeFilters();
            window.WORTHWARD_DATE_PICKERS?.dispose(runtime.investmentStockDetailsTableHost);
        }
        if (runtime.state.investmentAggregateSecurityTransferState.blocked) {
            runtime.clearInvestmentStockDetailsRangeControlBindings();
            runtime.destroyInvestmentStockDetailsPriceChart();
            runtime.investmentStockDetailsPanel.innerHTML = `
                <div class="investment-stock-details-empty-shell">
                    <p class="investment-holdings-empty">${runtime.escapeHtml(runtime.getInvestmentAggregateSecurityTransferBlockedMessage())}</p>
                </div>
            `;
            if (runtime.investmentStockDetailsTableHost instanceof HTMLElement) {
                runtime.investmentStockDetailsTableHost.innerHTML = '';
                runtime.syncInvestmentStockDetailsTableVisibility();
            }
            runtime.syncSelectedStockLinkState();
            return;
        }
        const activeTicker = runtime.ensureSelectedInvestmentStockTicker();
        runtime.destroyInvestmentStockDetailsPriceChart();
        if (!activeTicker) {
            runtime.clearInvestmentStockDetailsRangeControlBindings();
            runtime.investmentStockDetailsPanel.innerHTML = `
                <div class="investment-stock-details-empty-shell">
                    <p class="investment-holdings-empty">Open Holdings or import transactions, then pick a ticker to inspect its stock details.</p>
                </div>
            `;
            if (runtime.investmentStockDetailsTableHost instanceof HTMLElement) {
                runtime.investmentStockDetailsTableHost.innerHTML = '';
                runtime.syncInvestmentStockDetailsTableVisibility();
            }
            runtime.syncSelectedStockLinkState();
            return;
        }
        runtime.clearInvestmentStockDetailsRangeControlBindings();
        const tickerSummary = runtime.state.investmentTickerSummariesCache.find((summary) => runtime.normalizeInvestmentTicker(summary?.ticker) === activeTicker) || runtime.createPositionState(activeTicker);
        const profile = runtime.resolveInvestmentTickerProfile(tickerProfiles, activeTicker);
        const displayTicker = runtime.formatInvestmentTickerForDisplay(activeTicker);
        const companyName = runtime.resolveInvestmentTickerCompanyName(tickerProfiles, activeTicker);
        const logoUrls = runtime.resolveInvestmentLogoUrls(profile, activeTicker);
        const moneyMarketFundTokenLogoClass = runtime.getMoneyMarketFundTokenLogoClass(activeTicker);
        const identityLogoMarkup = moneyMarketFundTokenLogoClass
            ? `<span class="ticker-identity-logo ${moneyMarketFundTokenLogoClass}" aria-hidden="true"></span>`
            : `<img class="ticker-identity-logo"
                   alt=""
                   hidden
                   loading="eager"
                   decoding="async"
                   data-investment-logo-image
                   data-logo-url="${runtime.escapeHtml(JSON.stringify(logoUrls))}"
                   data-ticker="${runtime.escapeHtml(activeTicker)}">`;
        const identityLogoPlaceholderMarkup = moneyMarketFundTokenLogoClass
            ? ''
            : '<span class="ticker-identity-logo ticker-identity-logo-placeholder" aria-hidden="true"></span>';
        const detailRows = runtime.buildSafeInvestmentStockDetailRows(
            runtime.state.investmentProcessedTransactionsCache,
            activeTicker,
        );
        const stockDetailsPageState = runtime.state.activeInvestmentView === 'stock_details'
            ? runtime.buildInvestmentStockDetailsPage(detailRows)
            : {
                visibleTransactions: runtime.getVisibleInvestmentStockDetailTransactions(detailRows),
                pageTransactions: detailRows,
            };
        const totalCommission = detailRows.reduce((sum, txn) => sum + Math.abs(runtime.getTransactionCommission(txn)), 0);
        const totalCommissionCurrency = detailRows
            .map((txn) => runtime.formatTransactionCurrency(txn))
            .find((currency) => String(currency || '').trim());
        const normalizedTotalCommissionCurrency = String(totalCommissionCurrency || '').trim().toUpperCase();
        const totalCommissionDisplay = totalCommissionCurrency
            ? (normalizedTotalCommissionCurrency === 'USD'
                ? runtime.formatMetricLossAmount(totalCommission)
                : runtime.formatMetricLossAmountWithCurrency(totalCommission, totalCommissionCurrency))
            : runtime.formatMetricLossAmount(totalCommission);
        const totalCommissionClass = runtime.getNegativeMetricClass(totalCommission);
        const totalTradeCount = detailRows.filter((txn) => {
            const normalizedType = runtime.getNormalizedTransactionType(txn);
            return (
                normalizedType === 'buy'
                || normalizedType === 'sell'
            );
        }).length;
        const averagePriceDisplay = tickerSummary.averagePrice === null ? '-' : runtime.formatHoldingsMoney(tickerSummary.averagePrice);
        const averagePriceLabel = runtime.getInvestmentStockDetailsAveragePriceLabel();
        const totalTradeCountDisplay = new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(totalTradeCount);
        const realizedBreakdown = runtime.getStockDetailRealizedBreakdown(
            detailRows,
            tickerSummary.realizedPnlAccounts,
        );
        const realizedBreakdownDefinitions = [
            {key: 'dividendIncome', label: 'Dividend income'},
            {key: 'paymentInLieuIncome', label: 'Payment in lieu'},
            {key: 'dividendWithholding', label: 'Foreign tax withholding'},
            {key: 'tradingSpreadIncome', label: 'Trading spread income'},
        ];
        const aggregateRealizedDetails = realizedBreakdownDefinitions
            .filter(({key}) => Number(realizedBreakdown[key]) !== 0)
            .map(({key, label}) => ({
                label,
                value: runtime.formatHoldingsMoney(realizedBreakdown[key]),
                valueClass: runtime.getSignedMetricClass(realizedBreakdown[key]),
            }));
        const brokerRealizedDetails = realizedBreakdown.brokerBreakdown.length > 1
            ? realizedBreakdown.brokerBreakdown.flatMap((brokerBreakdown) => (
                realizedBreakdownDefinitions
                    .filter(({key}) => Number(brokerBreakdown[key]) !== 0)
                    .map(({key, label}) => ({
                        label: `${brokerBreakdown.brokerLabel} · ${label}`,
                        value: runtime.formatHoldingsMoney(brokerBreakdown[key]),
                        valueClass: runtime.getSignedMetricClass(brokerBreakdown[key]),
                    }))
            ))
            : [];
        const realizedDetails = brokerRealizedDetails.length
            ? brokerRealizedDetails
            : aggregateRealizedDetails;
        const brokerMetricDetails = runtime.buildInvestmentStockDetailBrokerMetrics(detailRows, activeTicker, tickerSummary.lastPrice);
        const hasBrokerMetricBreakdown = brokerMetricDetails.length > 1;
        const pnlUnavailable = tickerSummary?.pnlUnavailable === true;
        const totalPnl = pnlUnavailable
            ? null
            : (Number(tickerSummary.realizedPnl) || 0) + (Number(tickerSummary.unrealizedPnl) || 0);
        const totalPnlClass = pnlUnavailable
            ? ''
            : (totalPnl >= 0 ? 'investment-holdings-value-positive' : 'investment-holdings-value-negative');
        const realizedClass = pnlUnavailable
            ? ''
            : ((Number(tickerSummary.realizedPnl) || 0) >= 0 ? 'investment-holdings-value-positive' : 'investment-holdings-value-negative');
        const unrealizedClass = pnlUnavailable
            ? ''
            : ((Number(tickerSummary.unrealizedPnl) || 0) >= 0 ? 'investment-holdings-value-positive' : 'investment-holdings-value-negative');
        const lastPriceDisplay = tickerSummary.lastPrice === null ? '-' : runtime.formatHoldingsMoney(tickerSummary.lastPrice);
        const lastPriceClass = resolveInvestmentLastPriceToneClass(tickerSummary.lastPrice, activeTicker);
        const weightDisplay = tickerSummary.hasOpenPosition ? runtime.formatHoldingsPercent(tickerSummary.positionWeight) : '-';
        const stockMetricCards = [
            {
                label: 'Unrealized P&L',
                value: pnlUnavailable ? 'Unavailable' : (tickerSummary.unrealizedPnl === null ? '-' : runtime.formatHoldingsMoney(tickerSummary.unrealizedPnl)),
                valueClass: pnlUnavailable || tickerSummary.unrealizedPnl === null ? '' : unrealizedClass,
                liveField: pnlUnavailable ? '' : 'stock_unrealized_pnl',
                liveNumber: pnlUnavailable ? null : tickerSummary.unrealizedPnl,
            },
            {
                label: 'Realized P&L',
                value: pnlUnavailable ? 'Unavailable' : runtime.formatHoldingsMoney(tickerSummary.realizedPnl),
                valueClass: realizedClass,
                details: pnlUnavailable ? [] : realizedDetails,
            },
            {
                label: 'Total P&L',
                value: pnlUnavailable ? 'Unavailable' : runtime.formatHoldingsMoney(totalPnl),
                valueClass: totalPnlClass,
                liveField: pnlUnavailable ? '' : 'stock_total_pnl',
                liveNumber: pnlUnavailable ? null : totalPnl,
            },
            {
                label: 'Position',
                value: runtime.formatHoldingsPosition(tickerSummary.shares),
                valueClass: '',
                details: hasBrokerMetricBreakdown
                    ? brokerMetricDetails
                        .filter((metric) => !runtime.isFlatPosition(metric.shares))
                        .map((metric) => ({
                            label: metric.brokerLabel,
                            value: metric.positionDisplay,
                            valueClass: '',
                        }))
                    : [],
            },
            {
                label: 'Market value',
                value: tickerSummary.hasOpenPosition ? runtime.formatHoldingsMoney(tickerSummary.marketValue) : '-',
                valueClass: '',
                liveField: 'stock_market_value',
                liveNumber: tickerSummary.hasOpenPosition ? tickerSummary.marketValue : null,
                details: hasBrokerMetricBreakdown
                    ? brokerMetricDetails
                        .filter((metric) => !runtime.isFlatPosition(metric.shares))
                        .map((metric) => ({
                            label: metric.brokerLabel,
                            value: metric.marketValueDisplay,
                            valueClass: '',
                        }))
                    : [],
            },
            {
                label: averagePriceLabel,
                value: averagePriceDisplay,
                valueClass: '',
                details: [],
            },
            {
                label: 'Last price',
                value: lastPriceDisplay,
                valueClass: lastPriceClass.trim(),
                liveField: 'stock_last_price',
                liveNumber: tickerSummary.lastPrice,
            },
            {
                label: 'Portfolio weight',
                value: weightDisplay,
                valueClass: '',
                liveField: 'stock_position_weight',
                liveNumber: tickerSummary.hasOpenPosition ? tickerSummary.positionWeight : null,
            },
            {
                label: 'Total trades',
                value: totalTradeCountDisplay,
                valueClass: '',
                details: hasBrokerMetricBreakdown
                    ? brokerMetricDetails
                        .map((metric) => ({
                            label: metric.brokerLabel,
                            value: metric.totalTradesDisplay,
                            valueClass: '',
                        }))
                    : [],
            },
            {
                label: 'Total commission',
                value: totalCommissionDisplay,
                valueClass: totalCommissionClass,
                details: hasBrokerMetricBreakdown
                    ? brokerMetricDetails
                        .map((metric) => ({
                            label: metric.brokerLabel,
                            value: metric.totalCommissionDisplay,
                            valueClass: runtime.getNegativeMetricClass(metric.totalCommission),
                        }))
                    : [],
            },
        ];
        const rowsHtml = stockDetailsPageState.visibleTransactions.length
            ? runtime.renderInvestmentStockDetailsTableRowsMarkup(stockDetailsPageState.pageTransactions)
            : `
            <tr>
                <td colspan="10" class="investment-history-empty-cell">No ticker-linked transactions are available for this stock.</td>
            </tr>
        `;
        runtime.investmentStockDetailsPanel.innerHTML = `
            <div class="investment-stock-details-overview">
                <div class="suggestion-item timing-suggestion-item ticker-identity-item investment-stock-details-identity">
                    <div class="ticker-identity-row">
                        ${identityLogoMarkup}
                        ${identityLogoPlaceholderMarkup}
                        <span class="ticker-identity-copy">
                            <span class="suggestion-symbol ticker-identity-symbol">${runtime.escapeHtml(displayTicker)}</span>
                            ${runtime.renderInvestmentTickerIdentityNameHtml(companyName)}
                        </span>
                    </div>
                </div>
                <div class="trade-metrics-grid trade-view-panel-grid trade-metrics-panel-grid investment-stock-details-metrics">
                    ${stockMetricCards.map((metric, metricIndex) => (
                        renderInvestmentStockDetailsMetricCard(metric, metricIndex, activeTicker)
                    )).join('')}
                </div>
                <div class="investment-stock-details-price-chart-card">
                    ${runtime.renderInvestmentStockDetailsRangeControl()}
                    <div class="investment-stock-details-price-chart-shell" data-investment-stock-price-chart></div>
                </div>
                <div class="investment-stock-details-donut-card">
                    ${runtime.buildInvestmentStockDonutMarkup(tickerSummary, profile)}
                </div>
            </div>
        `;
        if (runtime.investmentStockDetailsTableHost instanceof HTMLElement) {
            runtime.investmentStockDetailsTableHost.innerHTML = `
                <div class="scrollable-data-table-shell local-store-pagination-host investment-history-table-shell investment-stock-details-table-shell">
                    <table class="settings-table trade-transactions-table scrollable-data-table investment-history-table investment-stock-details-table" data-table-header data-table-interactive-header aria-label="Ticker transaction columns and filters">
                        ${runtime.renderInvestmentStockDetailsColgroup()}
                        <thead>
                        <tr>
                            <th aria-label="Broker" data-markdown-export-label="Broker">${runtime.renderInvestmentBrokerFilterHeaderInnerMarkup('investment_stock_details_broker_filter')}</th>
                            <th data-markdown-export-label="No.">No.</th>
                            <th aria-label="Time" data-markdown-export-label="Time">Time</th>
                            <th aria-label="Side" data-markdown-export-label="Type">Type</th>
                            <th data-markdown-export-label="Description">Description</th>
                            <th aria-label="Currency" data-markdown-export-label="Currency">Currency</th>
                            <th data-markdown-export-label="Amount">Amount</th>
                            <th data-markdown-export-label="Commission">Commission</th>
                            <th data-markdown-export-label="Market value">Market value</th>
                            <th data-markdown-export-label="Realized P&amp;L">Realized P&amp;L</th>
                        </tr>
                        </thead>
                    </table>
                    <div class="trade-transactions-wrap scrollable-data-table-scroll investment-history-table-scroll investment-stock-details-table-scroll" id="investment_stock_details_table_scroll" data-table-scroll>
                        <table class="settings-table trade-transactions-table scrollable-data-table investment-history-table investment-stock-details-table" data-table-body>
                            ${runtime.renderInvestmentStockDetailsColgroup()}
                            <tbody id="investment_stock_details">${rowsHtml}</tbody>
                        </table>
                    </div>
                </div>
            `;
            const stockTableShell = runtime.investmentStockDetailsTableHost.querySelector('.investment-stock-details-table-shell');
            if (stockTableShell instanceof HTMLElement && runtime.investmentHistoryPagination instanceof HTMLElement) {
                stockTableShell.append(runtime.investmentHistoryPagination);
            }
            runtime.attachStockDetailsTableAlignmentSync(runtime.investmentStockDetailsTableHost);
            runtime.mountInvestmentBrokerFilterHeaders(runtime.investmentStockDetailsTableHost);
            runtime.mountInvestmentSideFilterHeaders(runtime.investmentStockDetailsTableHost);
            runtime.mountInvestmentCurrencyFilterHeaders(runtime.investmentStockDetailsTableHost);
            runtime.mountInvestmentStockDetailsTimeFilterHeaders(runtime.investmentStockDetailsTableHost);
            runtime.bindStockDetailsHistoryInteractions(runtime.investmentStockDetailsTableHost);
            runtime.syncInvestmentStockDetailsTableVisibility();
            if (runtime.state.activeInvestmentView === 'stock_details') {
                runtime.mountInvestmentHistoryPagination();
                runtime.renderInvestmentHistoryPagination(stockDetailsPageState.visibleTransactions.length, {force: true});
            }
        }
        bindInvestmentStockDetailsMetricBreakdownControls();
        runtime.bindInvestmentStockDetailsRangeControls(activeTicker, detailRows);
        if (pnlUnavailable) {
            const chartShell = runtime.investmentStockDetailsPanel.querySelector('[data-investment-stock-price-chart]');
            if (chartShell instanceof HTMLElement) {
                chartShell.innerHTML = '<p class="investment-holdings-empty">Cost-basis-derived stock analysis is unavailable until the transferred position has verified carried basis.</p>';
            }
        } else {
            runtime.renderInvestmentStockDetailsPriceChart(activeTicker, detailRows);
        }
        syncInvestmentStockDetailsLivePulse();
        runtime.bindHoldingsLogoFallbacks(runtime.investmentStockDetailsPanel);
        runtime.syncSelectedStockLinkState();
        runtime.syncInvestmentStockDetailsDonutFromInteraction();
        runtime.scheduleInvestmentStockDetailsVisibleLayoutSync();
    }

function selectInvestmentStockTicker(ticker, { focusView = false } = {}) {
        const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
        if (normalizedTicker) {
            runtime.state.selectedInvestmentStockTicker = normalizedTicker;
        }
        runtime.rememberInvestmentPageState({ ticker: runtime.state.selectedInvestmentStockTicker, view: focusView ? 'stock_details' : runtime.state.activeInvestmentView || 'chart' });
        if (focusView) {
            runtime.setInvestmentView('stock_details', { syncHash: false });
        }
        renderInvestmentStockDetailsPanel(window.WORTHWARD_INVESTMENT_DATA?.ticker_profiles || {});
        if (focusView || runtime.state.activeInvestmentView === 'stock_details') {
            runtime.syncInvestmentUrl({
                historyMode: focusView ? 'push' : 'replace',
                view: 'stock_details',
                ticker: runtime.state.selectedInvestmentStockTicker,
            });
        }
    }

function syncInvestmentViewFromLocationHash(fallbackView = 'chart') {
        const hash = String(window.location.hash || '').trim();
        if (hash === runtime.INVESTMENT_STOCK_DETAILS_HASH || hash === runtime.LEGACY_INVESTMENT_STOCK_DETAILS_HASH) {
            const locationTicker = runtime.getInvestmentLocationTicker();
            if (locationTicker) {
                runtime.state.selectedInvestmentStockTicker = locationTicker;
            }
            runtime.ensureSelectedInvestmentStockTicker();
            runtime.setInvestmentView('stock_details', { syncHash: false });
            return;
        }
        runtime.setInvestmentView(fallbackView, { syncHash: false });
    }

function applyInvestmentUrlStateFromLocation({render = false} = {}) {
        const urlState = runtime.parseInvestmentUrlState(window.location.href, {
            tickerNormalizer: runtime.normalizeInvestmentTicker,
        });
        runtime.state.investmentUrlStateApplying = true;
        try {
            if (urlState.ticker) {
                runtime.state.selectedInvestmentStockTicker = urlState.ticker;
            }
            if (urlState.view === 'stock_details') {
                runtime.state.selectedInvestmentStockDetailsRange = runtime.normalizeInvestmentStockDetailsRange(urlState.range);
            } else if (urlState.view === 'chart') {
                runtime.state.selectedInvestmentEquityRange = runtime.normalizeInvestmentEquityRange(urlState.range);
            }

            const availableBrokerCodes = runtime.getAvailableInvestmentBrokerCodes();
            if (urlState.view === 'metrics') {
                const requestedMetricsBroker = String(urlState.metricsBroker || 'all').trim().toLowerCase();
                const normalizedMetricsBroker = requestedMetricsBroker === 'all'
                    ? 'all'
                    : runtime.normalizeInvestmentBroker(requestedMetricsBroker);
                runtime.state.investmentBrokerSummarySelectedCode = normalizedMetricsBroker === 'all'
                    || !availableBrokerCodes.length
                    || availableBrokerCodes.includes(normalizedMetricsBroker)
                    ? normalizedMetricsBroker
                    : 'all';
                runtime.state.investmentBrokerSummarySelectionInitialized = true;
                runtime.rememberInvestmentPageState({
                    metricsBroker: runtime.state.investmentBrokerSummarySelectedCode,
                });
            } else if (urlState.brokerSelection.all) {
                runtime.state.investmentBrokerFilterSelectedCodes = new Set(availableBrokerCodes);
            } else {
                const selectedBrokerCodes = urlState.brokerSelection.codes
                    .map((brokerCode) => runtime.normalizeInvestmentBroker(brokerCode))
                    .filter((brokerCode) => availableBrokerCodes.includes(brokerCode));
                runtime.state.investmentBrokerFilterSelectedCodes = new Set(selectedBrokerCodes.length
                    ? selectedBrokerCodes
                    : availableBrokerCodes);
            }
            runtime.state.investmentSideFilter = window.WORTHWARD_INVESTMENT_FILTERS?.normalizeSideFilter(urlState.typeFilter) || 'all';
            runtime.state.investmentCurrencyFilter = runtime.normalizeInvestmentCurrencyFilter(urlState.currencyFilter);
            runtime.state.investmentDescriptionBindingFilter = runtime.normalizeInvestmentDescriptionBindingFilter(urlState.descriptionFilter);
            runtime.state.investmentStockDetailsDateFilter = urlState.dateFilter;
            runtime.state.investmentHistoryCurrentPage = urlState.page;
            runtime.setInvestmentView(urlState.view, {syncHash: false});
        } finally {
            runtime.state.investmentUrlStateApplying = false;
        }

        if (!render) return urlState;
        runtime.mountInvestmentBrokerFilterHeaders();
        runtime.mountInvestmentBrokerSummarySelector();
        runtime.mountInvestmentSideFilterHeaders();
        runtime.mountInvestmentCurrencyFilterHeaders();
        runtime.mountInvestmentDescriptionBindingFilterHeaders();
        runtime.renderInvestmentHistoryTableRows(
            runtime.state.investmentProcessedTransactionsCache,
            runtime.state.investmentChartPointsCache,
            {resetPage: false, scrollToTop: false},
        );
        runtime.updateInvestmentEquityRangePill();
        runtime.syncInvestmentHistoryHeading();
        runtime.updateInvestmentEquityChartDisplay(runtime.getInvestmentEquityChartInputPoints(runtime.state.investmentChartPointsCache));
        if (runtime.state.activeInvestmentView === 'stock_details') {
            runtime.refreshInvestmentStockDetailsTableRows();
        }
        if (runtime.state.activeInvestmentView === 'metrics') {
            runtime.ensureInvestmentMetricsBrokerScope();
        }
        runtime.syncInvestmentStockDetailsTableVisibility();
        runtime.syncInvestmentUrl({historyMode: 'replace'});
        runtime.state.investmentUrlStateReady = true;
        return urlState;
    }

    return {
        normalizeShareHoldingsMoneyText,
        resolveShareHoldingsMetricToneClass,
        populateShareHoldingsMetricCell,
        formatHoldingsLocalMoney,
        formatSignedHoldingsLocalMoney,
        formatHoldingsLocalCurrencyLine,
        shouldShowHoldingsLocalCurrencyLine,
        renderHoldingsDualCurrencyValue,
        renderInvestmentLiveValue,
        calculateHoldingsSummaryAllocation,
        getInvestmentHoldingsAllocationBadgeToneClass,
        getInvestmentHoldingsDailyPnlBadgeToneClass,
        getInvestmentHoldingsRealizedToneClass,
        renderInvestmentHoldingsAllocationBadgeValueContent,
        renderInvestmentHoldingsDailyPnlBadge,
        updateInvestmentHoldingsDailyPnlBadge,
        syncInvestmentHoldingsLiveBadgeVisibility,
        renderInvestmentHoldingsAllocationBadge,
        updateInvestmentHoldingsAllocationBadge,
        applyInvestmentCurrentTotalEquityToSummaryWeights,
        buildInvestmentCurrentEquityChartPoints,
        isInvestmentCurrentSnapshotDate,
        computeHoldingsCashEquivalents,
        resolveInvestmentTickerReferenceClose,
        getInvestmentHoldingSessionDate,
        resolveInvestmentTickerPreviousClose,
        resolveInvestmentHoldingDailyPnl,
        resolveInvestmentHoldingDailyPriceChange,
        resolveInvestmentLastPriceToneClass,
        getInvestmentHoldingsRealtimeState,
        syncInvestmentHoldingsRealtimeValues,
        syncInvestmentStockDetailsLivePulse,
        syncInvestmentStockDetailsRealtimeMetrics,
        renderInvestmentStockDetailsMetricValueSpan,
        renderInvestmentStockDetailsLiveMetricValueSpan,
        renderInvestmentStockDetailsMetricCard,
        bindInvestmentStockDetailsMetricBreakdownControls,
        renderInvestmentStockDetailsPanel,
        selectInvestmentStockTicker,
        syncInvestmentViewFromLocationHash,
        applyInvestmentUrlStateFromLocation,
    };
}

