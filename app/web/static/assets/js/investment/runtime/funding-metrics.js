/**
 * Funding and broker-benefit metric calculations.
 *
 * Code version: v1.0.0
 * - Added: Extracted from the Investment workspace composition root.
 */

export function createInvestmentFundingMetricsRuntime(runtime) {
function formatAmount(value) {
        if (value === undefined || value === null || isNaN(value)) return '--';
        return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

function getOptionalInvestmentNumber(value) {
        return runtime.parseInvestmentOptionalNumber(value);
    }

function formatMetricLossAmount(value) {
        if (value === undefined || value === null || Number.isNaN(Number(value))) return '--';
        const numericValue = Number(value);
        if (Math.abs(numericValue) < 1e-9) return formatAmount(0);
        return formatAmount(-Math.abs(numericValue));
    }

function formatMetricLossAmountWithCurrency(value, currency) {
        if (value === undefined || value === null || Number.isNaN(Number(value))) return '--';
        const numericValue = Number(value);
        if (Math.abs(numericValue) < 1e-9) return runtime.formatAmountWithCurrency(0, currency, { showUsdSymbol: false });
        return runtime.formatAmountWithCurrency(-Math.abs(numericValue), currency, { showUsdSymbol: false });
    }

function getNegativeMetricClass(value) {
        const numericValue = Number(value);
        return Number.isFinite(numericValue) && Math.abs(numericValue) > 1e-9
            ? 'investment-holdings-value-negative'
            : '';
    }

function getSignedMetricClass(value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue) || Math.abs(numericValue) <= 1e-9) return '';
        return numericValue >= 0
            ? 'investment-holdings-value-positive'
            : 'investment-holdings-value-negative';
    }

function getTotalDeposits(transactions) {
        return transactions
            .filter(t => runtime.getNormalizedTransactionType(t) === 'deposit')
            .reduce((sum, t) => sum + runtime.getTransactionAmount(t), 0);
    }

function getInvestmentMetricTransactionCurrency(txn, baseCurrency = runtime.getInvestmentBaseCurrency()) {
        const explicitCurrency = String(txn?.currency || '').trim().toUpperCase();
        if (/^[A-Z]{3}$/.test(explicitCurrency)) return explicitCurrency;
        const formattedCurrency = String(runtime.formatTransactionCurrency(txn) || '').trim().toUpperCase();
        return /^[A-Z]{3}$/.test(formattedCurrency)
            ? formattedCurrency
            : baseCurrency;
    }

function getInvestmentMetricBaseAmount(amount, txn, fxTimeline, baseCurrency) {
        return runtime.convertAmountToBaseCurrency(
            amount,
            getInvestmentMetricTransactionCurrency(txn, baseCurrency),
            runtime.normalizeLedgerDate(txn?.date),
            fxTimeline,
            baseCurrency,
        );
    }

function classifyInvestmentRealizedCashFlow(txn) {
        const normalizedType = runtime.getNormalizedTransactionType(txn);
        if (normalizedType === 'dividend' || normalizedType === 'payment_in_lieu') return 'dividend';
        if (normalizedType === 'foreign_tax_withholding') return 'dividend';
        if (normalizedType === 'credit_interest') return 'interest_credit';
        if (normalizedType === 'debit_interest') return 'interest_charge';
        if (normalizedType === 'fee') return 'fee';
        if (normalizedType !== 'adjustment') return '';

        const description = String(txn?.description || '').toLowerCase();
        if (/\b(withholding|tax)\b/.test(description)) return 'dividend';
        if (/\b(debit|short selling)\b.*\binterest\b|\binterest\b.*\b(debit|short selling)\b/.test(description)) {
            return 'interest_charge';
        }
        if (/\b(commission|trade fee|bank charges?|fee)\b/.test(description)) return 'fee';
        return '';
    }

function getInvestmentHistoricalRealizedPnl(transactions, tickerSummaries) {
        const safeTransactions = Array.isArray(transactions) ? transactions : [];
        const safeTickerSummaries = Array.isArray(tickerSummaries) ? tickerSummaries : [];
        // Historical hover is an as-of replay. Current broker position/performance
        // snapshots have no historical as-of guarantee and must never overwrite
        // the point-in-time transaction replay assembled for the hovered date.
        const pnlUnavailableTickers = new Set(
            safeTickerSummaries
                .filter((summary) => summary?.pnlUnavailable === true)
                .map((summary) => runtime.getInvestmentCanonicalTicker(summary?.ticker))
                .filter(Boolean),
        );
        const baseCurrency = runtime.getInvestmentBaseCurrency();
        const fxTimeline = runtime.buildInvestmentFxRateTimeline(safeTransactions, baseCurrency);
        let brokerRewardRealizedPnl = 0;
        let standaloneCashRealizedPnl = 0;

        safeTransactions.forEach((txn) => {
            const benefitType = classifyBrokerBenefitTransaction(txn);
            if (benefitType) {
                const amount = Math.abs(runtime.getTransactionAmount(txn));
                if (amount > 1e-9) {
                    const currency = runtime.formatTransactionCurrency(txn) || baseCurrency;
                    const sourceAmount = benefitType === 'coupon_hkd_notional' ? 100 : amount;
                    const sourceCurrency = benefitType === 'coupon_hkd_notional' ? 'HKD' : currency;
                    brokerRewardRealizedPnl += runtime.convertAmountToBaseCurrency(
                        sourceAmount,
                        sourceCurrency,
                        runtime.normalizeLedgerDate(txn?.date),
                        fxTimeline,
                        baseCurrency,
                    );
                }
            }

            const tracksHolding = runtime.shouldTrackHoldingTicker(txn);
            const canonicalTicker = tracksHolding
                ? runtime.getInvestmentCanonicalTicker(txn?.ticker)
                : '';
            if (canonicalTicker && pnlUnavailableTickers.has(canonicalTicker)) return;
            const cashFlowCategory = classifyInvestmentRealizedCashFlow(txn);
            const normalizedType = runtime.getNormalizedTransactionType(txn);
            const isStandaloneCashFlow = (
                cashFlowCategory === 'interest_credit'
                || cashFlowCategory === 'interest_charge'
                || (
                    cashFlowCategory === 'fee'
                    && !(tracksHolding && normalizedType === 'adjustment')
                )
            );
            if (!isStandaloneCashFlow) return;
            standaloneCashRealizedPnl += getInvestmentMetricBaseAmount(
                runtime.getTransactionAmount(txn),
                txn,
                fxTimeline,
                baseCurrency,
            );
        });

        const holdingsRealizedPnl = safeTickerSummaries.reduce(
            (sum, summary) => sum + (
                Number(runtime.getInvestmentCanonicalSummaryRealizedPnl(summary)) || 0
            ),
            0,
        );
        return holdingsRealizedPnl + brokerRewardRealizedPnl + standaloneCashRealizedPnl;
    }

function getRealizedPnlAttribution(transactions, tickerSummaries, brokerBenefitMetrics) {
        const safeTransactions = Array.isArray(transactions) ? transactions : [];
        const safeTickerSummaries = Array.isArray(tickerSummaries) ? tickerSummaries : [];
        const pnlUnavailableTickers = new Set(
            safeTickerSummaries
                .filter((summary) => summary?.pnlUnavailable === true)
                .map((summary) => runtime.getInvestmentCanonicalTicker(summary?.ticker))
                .filter(Boolean),
        );
        const baseCurrency = runtime.getInvestmentBaseCurrency();
        const fxTimeline = runtime.buildInvestmentFxRateTimeline(safeTransactions, baseCurrency);
        const priceHistory = runtime.normalizePriceHistoryPayload(
            window.WORTHWARD_INVESTMENT_DATA?.price_history_by_ticker || {},
        );
        const tickerPriceIndex = runtime.buildTickerPriceIndex(priceHistory);
        const renderedSplitFactorHints = runtime.buildRenderedSplitFactorHints(safeTransactions, tickerPriceIndex);
        const sortedTransactions = getSortedInvestmentTaxLotMetricTransactions(safeTransactions);
        const lotStates = new Map();
        const categoryAmounts = {
            tradingSpreadGains: 0,
            cutLosses: 0,
            dividendsNet: 0,
            cashRewards: runtime.getBrokerRewardRealizedIncome(brokerBenefitMetrics),
            interestCredited: 0,
            interestCharged: 0,
            commissionsAndFees: 0,
        };
        const realizedPnlRowSet = new Set(runtime.getBrokerRewardLedgerRows(brokerBenefitMetrics));
        let standaloneCashRealizedPnl = 0;
        let conversionIncomplete = false;

        const recordCategoryAmount = (key, value, ledgerNo) => {
            const numericValue = Number(value);
            if (!Number.isFinite(numericValue)) {
                conversionIncomplete = true;
                return;
            }
            if (Math.abs(numericValue) <= 1e-9) return;
            categoryAmounts[key] += numericValue;
            realizedPnlRowSet.add(ledgerNo);
        };
        const addStandaloneCashAmount = (key, value, ledgerNo) => {
            const numericValue = Number(value);
            if (!Number.isFinite(numericValue)) {
                conversionIncomplete = true;
                return;
            }
            if (Math.abs(numericValue) <= 1e-9) return;
            standaloneCashRealizedPnl += numericValue;
            recordCategoryAmount(key, numericValue, ledgerNo);
        };

        sortedTransactions.forEach(({ txn, ledgerNo }) => {
            const normalizedType = runtime.getNormalizedTransactionType(txn);
            const tracksHolding = runtime.shouldTrackHoldingTicker(txn);
            const canonicalTicker = tracksHolding
                ? runtime.getInvestmentCanonicalTicker(txn?.ticker)
                : '';
            // Do not let a transferred ticker with unverified carried basis
            // contaminate aggregate realized-P&L categories. Cash-only rows
            // and unaffected tickers remain fully attributable.
            if (canonicalTicker && pnlUnavailableTickers.has(canonicalTicker)) return;
            const cashFlowCategory = classifyInvestmentRealizedCashFlow(txn);
            const baseAmount = getInvestmentMetricBaseAmount(
                runtime.getTransactionAmount(txn),
                txn,
                fxTimeline,
                baseCurrency,
            );

            if (tracksHolding) {
                realizedPnlRowSet.add(ledgerNo);
            }

            if (tracksHolding && ['buy', 'sell', 'grant', 'dividend_reinvestment', 'transfer_in', 'transfer_out'].includes(normalizedType)) {
                const quantity = Math.abs(Number(
                    runtime.getTransactionValuationQuantity(txn, tickerPriceIndex, renderedSplitFactorHints),
                ));
                if (canonicalTicker && Number.isFinite(quantity) && quantity > 1e-9) {
                    const lotScopeKey = runtime.getTransactionLotScopeKey(txn, canonicalTicker);
                    if (!lotStates.has(lotScopeKey)) {
                        lotStates.set(lotScopeKey, runtime.createPositionState(canonicalTicker));
                    }
                    const lotState = lotStates.get(lotScopeKey);
                    const rawPrice = runtime.getTransactionPrice(txn);
                    const unitPrice = Number.isFinite(rawPrice) && rawPrice >= 0
                        ? rawPrice
                        : runtime.getTransactionEffectiveUnitPrice(txn, quantity);

                    if (normalizedType === 'buy') {
                        runtime.applyDirectionalTrade(lotState, 'long', quantity, unitPrice);
                    } else if (normalizedType === 'grant' || normalizedType === 'dividend_reinvestment' || normalizedType === 'transfer_in') {
                        lotState.shares += quantity;
                    } else if (normalizedType === 'transfer_out') {
                        lotState.shares -= quantity;
                    } else if (normalizedType === 'sell') {
                        const spreadPnl = getInvestmentMetricBaseAmount(
                            runtime.applyDirectionalTrade(lotState, 'short', quantity, unitPrice),
                            txn,
                            fxTimeline,
                            baseCurrency,
                        );
                        recordCategoryAmount(
                            spreadPnl >= 0 ? 'tradingSpreadGains' : 'cutLosses',
                            spreadPnl,
                            ledgerNo,
                        );
                    }

                    if (['buy', 'sell'].includes(normalizedType)) {
                        const commission = Math.abs(runtime.getTransactionCommission(txn));
                        if (commission > 1e-9) {
                            recordCategoryAmount(
                                'commissionsAndFees',
                                -getInvestmentMetricBaseAmount(commission, txn, fxTimeline, baseCurrency),
                                ledgerNo,
                            );
                        }
                    }
                }
            }

            if (cashFlowCategory === 'dividend' && tracksHolding && txn?.source?.excluded_from_broker_pnl !== true) {
                recordCategoryAmount('dividendsNet', baseAmount, ledgerNo);
                return;
            }

            if (cashFlowCategory === 'interest_credit') {
                addStandaloneCashAmount('interestCredited', baseAmount, ledgerNo);
                return;
            }
            if (cashFlowCategory === 'interest_charge') {
                addStandaloneCashAmount('interestCharged', baseAmount, ledgerNo);
                return;
            }
            if (cashFlowCategory === 'fee') {
                if (tracksHolding && normalizedType === 'adjustment') {
                    recordCategoryAmount('commissionsAndFees', baseAmount, ledgerNo);
                } else {
                    addStandaloneCashAmount('commissionsAndFees', baseAmount, ledgerNo);
                }
            }
        });

        const holdingsRealizedPnl = safeTickerSummaries.reduce(
            (sum, summary) => sum + (
                Number(runtime.getInvestmentCanonicalSummaryRealizedPnl(summary)) || 0
            ),
            0,
        );
        const totalRealizedPnl = (
            holdingsRealizedPnl
            + categoryAmounts.cashRewards
            + standaloneCashRealizedPnl
        );
        const classifiedPnl = Object.values(categoryAmounts).reduce(
            (sum, value) => sum + (Number(value) || 0),
            0,
        );
        const reconciliation = totalRealizedPnl - classifiedPnl;
        const detailDefinitions = [
            ['tradingSpreadGains', 'Trading spread gains'],
            ['dividendsNet', 'Dividends, net of withholding'],
            ['cashRewards', 'Cash rewards'],
            ['interestCredited', 'Interest credited'],
            ['cutLosses', 'Cut losses'],
            ['interestCharged', 'Interest charged'],
            ['commissionsAndFees', 'Commissions / fees'],
        ];
        const realizedPnlDetails = detailDefinitions
            .map(([key, label]) => ({
                key,
                label,
                amount: categoryAmounts[key],
            }))
            .filter((detail) => Math.abs(Number(detail.amount) || 0) >= 0.005)
            .map((detail) => ({
                label: detail.label,
                value: runtime.formatSignedHoldingsMoney(detail.amount),
                valueClass: getSignedMetricClass(detail.amount),
            }));
        if (Math.abs(reconciliation) >= 0.005) {
            realizedPnlDetails.push({
                label: 'Broker-reported reconciliation',
                value: runtime.formatSignedHoldingsMoney(reconciliation),
                valueClass: getSignedMetricClass(reconciliation),
            });
        }

        return {
            totalRealizedPnl: conversionIncomplete ? null : totalRealizedPnl,
            realizedPnlRows: Array.from(realizedPnlRowSet),
            realizedPnlDetails,
        };
    }

function getHoldingsSummaryMetrics(
        transactions,
        latestPrices,
        TOTAL_EQUITY,
        brokerBenefitMetrics = null,
        { brokerCode = 'all', currentCash = null } = {},
    ) {
        const safeTransactions = Array.isArray(transactions) ? transactions : [];
        const safeLatestPrices = latestPrices && typeof latestPrices === 'object' ? latestPrices : {};
        const tickerSummaries = runtime.applyInvestmentAggregatePnlAvailability(
            runtime.buildTickerSummaries(
                safeTransactions,
                safeLatestPrices,
                TOTAL_EQUITY,
                runtime.normalizePriceHistoryPayload(window.WORTHWARD_INVESTMENT_DATA?.price_history_by_ticker || {})
            ),
        );
        const resolvedBrokerBenefitMetrics = brokerBenefitMetrics || getBrokerBenefitMetrics(
            safeTransactions,
            safeLatestPrices,
            TOTAL_EQUITY,
        );
        const realizedPnlAttribution = getRealizedPnlAttribution(
            safeTransactions,
            tickerSummaries,
            resolvedBrokerBenefitMetrics,
        );
        const pnlCoverage = runtime.getInvestmentAggregatePnlCoverage(tickerSummaries);
        if (!Number.isFinite(realizedPnlAttribution.totalRealizedPnl)) {
            pnlCoverage.cashFlowFxUnavailable = true;
            pnlCoverage.status = pnlCoverage.completeCount > 0 ? 'partial' : 'unavailable';
        }
        const pnlUnavailable = pnlCoverage.status !== 'complete'
            || !Number.isFinite(realizedPnlAttribution.totalRealizedPnl);
        const totalRealizedPnl = pnlUnavailable ? null : realizedPnlAttribution.totalRealizedPnl;
        const totalUnrealizedPnl = pnlUnavailable
            ? null
            : tickerSummaries.reduce((sum, summary) => sum + (Number(summary.unrealizedPnl) || 0), 0);
        const cumulativePnl = pnlUnavailable ? null : totalRealizedPnl + totalUnrealizedPnl;
        const openSummaries = tickerSummaries.filter((summary) => summary?.hasOpenPosition === true);
        const hasUnavailableMarketValue = openSummaries.some(
            (summary) => !Number.isFinite(summary?.marketValue),
        );
        const marketValue = hasUnavailableMarketValue
            ? null
            : openSummaries.reduce((sum, summary) => sum + Number(summary.marketValue), 0);
        const currentCashSnapshot = runtime.resolveInvestmentMetricsCurrentCash(
            safeTransactions,
            brokerCode,
            currentCash,
        );
        const cash = currentCashSnapshot.cash;
        const resolvedTotalEquity = Number.isFinite(cash) && Number.isFinite(marketValue)
            ? cash + marketValue
            : null;
        const openTickers = new Set(
            tickerSummaries
                .filter((summary) => summary.hasOpenPosition)
                .map((summary) => runtime.normalizeInvestmentTicker(summary.ticker))
                .filter(Boolean)
        );
        const unavailableTickers = new Set(
            tickerSummaries
                .filter((summary) => summary?.pnlUnavailable === true)
                .map((summary) => runtime.getInvestmentCanonicalTicker(summary?.ticker))
                .filter(Boolean),
        );
        const sortedTransactions = safeTransactions
            .map((txn, index) => ({ txn, index }))
            .sort((left, right) => runtime.compareInvestmentTransactions(left.txn, right.txn, left.index, right.index))
            .map(({ txn }, sortedIndex) => ({
                txn,
                ledgerNo: sortedIndex + 1,
            }));
        const realizedPnlRows = [...realizedPnlAttribution.realizedPnlRows];
        const unrealizedPnlRows = [];
        const unrealizedPnlDetails = tickerSummaries
            .filter((summary) => (
                summary?.hasOpenPosition === true
                && summary?.pnlUnavailable !== true
                && Number.isFinite(Number(summary?.unrealizedPnl))
            ))
            .map((summary) => ({
                label: runtime.formatInvestmentTickerForDisplay(summary.ticker),
                value: runtime.formatSignedHoldingsMoney(summary.unrealizedPnl),
                valueClass: getSignedMetricClass(summary.unrealizedPnl),
            }));

        sortedTransactions.forEach(({ txn, ledgerNo }) => {
            if (!runtime.shouldTrackHoldingTicker(txn)) return;
            const normalizedTicker = runtime.getInvestmentCanonicalTicker(txn?.ticker);
            if (
                normalizedTicker
                && openTickers.has(normalizedTicker)
                && !unavailableTickers.has(normalizedTicker)
            ) {
                unrealizedPnlRows.push(ledgerNo);
            }
        });

        return {
            cash,
            cashIsApproximate: currentCashSnapshot.cashIsApproximate === true,
            marketValue,
            totalEquity: resolvedTotalEquity,
            totalRealizedPnl,
            totalUnrealizedPnl,
            cumulativePnl,
            pnlUnavailable,
            pnlCoverage,
            realizedPnlRows: pnlUnavailable ? [] : realizedPnlRows,
            realizedPnlDetails: pnlUnavailable ? [] : realizedPnlAttribution.realizedPnlDetails,
            unrealizedPnlRows: pnlUnavailable ? [] : unrealizedPnlRows,
            unrealizedPnlDetails: pnlUnavailable ? [] : unrealizedPnlDetails,
            cumulativePnlRows: pnlUnavailable ? [] : Array.from(new Set([
                ...realizedPnlRows,
                ...unrealizedPnlRows,
            ])),
        };
    }

function getSortedInvestmentMetricTransactions(transactions) {
        return (Array.isArray(transactions) ? transactions : [])
            .map((txn, index) => ({ txn, index }))
            .sort((left, right) => runtime.compareInvestmentTransactions(left.txn, right.txn, left.index, right.index))
            .map(({ txn, index }, sortedIndex) => ({
                txn,
                ledgerNo: sortedIndex + 1,
                sourceIndex: index,
            }));
    }

function getSortedInvestmentTaxLotMetricTransactions(transactions) {
        const safeTransactions = Array.isArray(transactions) ? transactions : [];
        const displayLedgerNos = new Map(
            getSortedInvestmentMetricTransactions(safeTransactions)
                .map(({sourceIndex, ledgerNo}) => [sourceIndex, ledgerNo]),
        );
        return safeTransactions
            .map((txn, sourceIndex) => ({
                txn,
                sourceIndex,
                ledgerNo: displayLedgerNos.get(sourceIndex) ?? sourceIndex + 1,
            }))
            .sort((left, right) => runtime.compareInvestmentTaxLotTransactions(
                left.txn,
                right.txn,
                left.sourceIndex,
                right.sourceIndex,
            ));
    }

function getLatestInvestmentMetricPrice(ticker, latestPrices) {
        const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
        const candidates = [
            ticker,
            normalizedTicker,
            runtime.getInvestmentCanonicalTicker(normalizedTicker),
            normalizedTicker.endsWith('.US') ? normalizedTicker.slice(0, -3) : '',
        ].filter(Boolean);
        const priceStore = latestPrices && typeof latestPrices === 'object' ? latestPrices : {};
        for (const candidate of candidates) {
            const rawValue = priceStore[candidate];
            const numericValue = Number(
                rawValue && typeof rawValue === 'object'
                    ? rawValue.price ?? rawValue.last ?? rawValue.close ?? rawValue.value
                    : rawValue
            );
            if (Number.isFinite(numericValue) && numericValue > 0) {
                return numericValue;
            }
        }
        return null;
    }

function classifyBrokerBenefitTransaction(txn) {
        if (!runtime.isKolRewardTransaction(txn)) return '';
        const broker = String(txn?.broker || '').trim().toLowerCase();
        const description = String(txn?.description || '').trim();
        const rawItem = String(txn?.source?.statement_item_raw || '').trim();
        const normalizedText = `${description} ${rawItem}`.toLowerCase();
        const amount = Math.abs(runtime.getTransactionAmount(txn));

        if (runtime.getNormalizedTransactionType(txn) === 'kol_reward') return 'kol_reward';
        if (/\bkol\b/i.test(description)) return 'kol_reward';
        if (broker === 'longbridge_sg') return 'kol_reward';
        if (broker === 'tigertrade' && description === 'Order Rebate' && amount >= 12) {
            return 'coupon_hkd_notional';
        }
        if (broker === 'tigertrade') {
            return 'coupon_usd';
        }
        if (
            normalizedText.includes('cash card')
            || normalizedText.includes('cash coupon')
            || normalizedText.includes('cash reward')
            || normalizedText.includes('stock cash')
            || normalizedText.includes('rewards center')
            || normalizedText.includes('股票卡')
            || normalizedText.includes('现金卡')
            || normalizedText.includes('現金卡')
            || normalizedText.includes('任务中心')
            || normalizedText.includes('任務中心')
            || normalizedText.includes('开户礼')
            || normalizedText.includes('開戶禮')
            || normalizedText.includes('入金礼')
            || normalizedText.includes('入金禮')
        ) {
            return 'cash_reward';
        }
        if (
            normalizedText.includes('coupon')
            || normalizedText.includes('rebate')
            || normalizedText.includes('优惠券')
            || normalizedText.includes('優惠券')
            || normalizedText.includes('抵扣卡')
        ) {
            return 'coupon';
        }
        return 'cash_reward';
    }

function getStockGrantBenefitMetrics(transactions, latestPrices, TOTAL_EQUITY) {
        const safeTransactions = Array.isArray(transactions) ? transactions : [];
        const priceHistory = runtime.normalizePriceHistoryPayload(window.WORTHWARD_INVESTMENT_DATA?.price_history_by_ticker || {});
        const tickerPriceIndex = runtime.buildTickerPriceIndex(priceHistory);
        const renderedSplitFactorHints = runtime.buildRenderedSplitFactorHints(safeTransactions, tickerPriceIndex);
        const baseCurrency = runtime.getInvestmentBaseCurrency();
        const fxTimeline = runtime.buildInvestmentFxRateTimeline(safeTransactions, baseCurrency);
        const sortedTransactions = getSortedInvestmentMetricTransactions(safeTransactions);
        const lotStates = new Map();
        let stockGrantRealizedPnl = 0;
        let stockGrantUnrealizedPnl = 0;
        const stockGrantRealizedRowSet = new Set();
        const stockGrantUnrealizedRowSet = new Set();

        const getStateKey = (txn) => [
            String(txn?.broker || '').trim().toLowerCase(),
            String(txn?.account || '').trim(),
            runtime.getInvestmentCanonicalTicker(txn?.ticker),
        ].join('|');

        sortedTransactions.forEach(({ txn, ledgerNo }) => {
            if (!runtime.shouldTrackHoldingTicker(txn)) return;
            const normalizedType = runtime.getNormalizedTransactionType(txn);
            if (!['buy', 'sell', 'grant', 'dividend_reinvestment'].includes(normalizedType)) return;
            const stateKey = getStateKey(txn);
            if (!stateKey.endsWith(`|${runtime.getInvestmentCanonicalTicker(txn?.ticker)}`)) return;
            const quantity = Math.abs(Number(runtime.getTransactionValuationQuantity(txn, tickerPriceIndex, renderedSplitFactorHints)));
            if (!Number.isFinite(quantity) || quantity <= 0) return;
            const currency = runtime.formatTransactionCurrency(txn) || runtime.getTickerQuoteCurrency(txn?.ticker) || baseCurrency;
            const ledgerDate = runtime.normalizeLedgerDate(txn?.date);
            if (!lotStates.has(stateKey)) {
                lotStates.set(stateKey, []);
            }
            const lots = lotStates.get(stateKey);

            if (['buy', 'grant', 'dividend_reinvestment'].includes(normalizedType)) {
                lots.push({
                    remainingQuantity: quantity,
                    isGrant: normalizedType === 'grant',
                    rowNo: ledgerNo,
                    ticker: runtime.getInvestmentCanonicalTicker(txn?.ticker),
                    currency,
                });
                return;
            }

            const grossAmount = Math.abs(runtime.getTransactionEconomicAmount(txn));
            const unitProceeds = quantity > 0 ? grossAmount / quantity : 0;
            let remainingToClose = quantity;
            while (remainingToClose > 1e-9 && lots.length) {
                const lot = lots[0];
                const consumedQuantity = Math.min(remainingToClose, lot.remainingQuantity);
                if (lot.isGrant && unitProceeds > 0) {
                    const realizedLocal = consumedQuantity * unitProceeds;
                    stockGrantRealizedPnl += runtime.convertAmountToBaseCurrency(
                        realizedLocal,
                        currency,
                        ledgerDate,
                        fxTimeline,
                        baseCurrency,
                    );
                    stockGrantRealizedRowSet.add(ledgerNo);
                    stockGrantRealizedRowSet.add(lot.rowNo);
                }
                lot.remainingQuantity -= consumedQuantity;
                remainingToClose -= consumedQuantity;
                if (lot.remainingQuantity <= 1e-9) {
                    lots.shift();
                }
            }
        });

        lotStates.forEach((lots) => {
            lots.forEach((lot) => {
                if (!lot.isGrant || !(lot.remainingQuantity > 1e-9)) return;
                const latestPrice = getLatestInvestmentMetricPrice(lot.ticker, latestPrices);
                if (!(latestPrice > 0)) return;
                stockGrantUnrealizedPnl += runtime.convertAmountToBaseCurrency(
                    lot.remainingQuantity * latestPrice,
                    lot.currency,
                    runtime.getTodayLedgerDate(),
                    fxTimeline,
                    baseCurrency,
                );
                stockGrantUnrealizedRowSet.add(lot.rowNo);
            });
        });

        return {
            stockGrantRealizedPnl,
            stockGrantUnrealizedPnl,
            stockGrantRealizedRows: Array.from(stockGrantRealizedRowSet),
            stockGrantUnrealizedRows: Array.from(stockGrantUnrealizedRowSet),
        };
    }

function getBrokerBenefitMetrics(transactions, latestPrices, TOTAL_EQUITY) {
        const safeTransactions = Array.isArray(transactions) ? transactions : [];
        const sortedTransactions = getSortedInvestmentMetricTransactions(safeTransactions);
        const baseCurrency = runtime.getInvestmentBaseCurrency();
        const fxTimeline = runtime.buildInvestmentFxRateTimeline(safeTransactions, baseCurrency);
        let couponRebateHkd = 0;
        let couponRebateUsd = 0;
        let cashRewardHkd = 0;
        let cashRewardUsd = 0;
        let kolRewardIncome = 0;
        let couponRebateIncome = 0;
        let cashRewardIncome = 0;
        let hasNonUsdRewardSource = false;
        let couponAndCashRewardIncome = 0;
        let hasNonUsdCouponAndCashRewardSource = false;
        const couponRebateHkdRowSet = new Set();
        const couponRebateUsdRowSet = new Set();
        const cashRewardHkdRowSet = new Set();
        const cashRewardUsdRowSet = new Set();
        const kolRewardRowSet = new Set();
        const couponAndCashRewardRowSet = new Set();
        const couponAndCashRewardDetailsByKey = new Map();

        const recordCouponAndCashReward = ({
            category,
            currency,
            sourceAmount,
            convertedAmount,
            ledgerNo,
        }) => {
            const normalizedCurrency = String(currency || baseCurrency).trim().toUpperCase() || baseCurrency;
            const normalizedSourceAmount = Number(sourceAmount);
            const normalizedConvertedAmount = Number(convertedAmount);
            if (!Number.isFinite(normalizedSourceAmount) || !Number.isFinite(normalizedConvertedAmount)) return;
            couponAndCashRewardIncome += normalizedConvertedAmount;
            hasNonUsdCouponAndCashRewardSource = (
                hasNonUsdCouponAndCashRewardSource || normalizedCurrency !== 'USD'
            );
            couponAndCashRewardRowSet.add(ledgerNo);
            const detailKey = `${category}|${normalizedCurrency}`;
            const detail = couponAndCashRewardDetailsByKey.get(detailKey) || {
                category,
                currency: normalizedCurrency,
                sourceAmount: 0,
            };
            detail.sourceAmount += normalizedSourceAmount;
            couponAndCashRewardDetailsByKey.set(detailKey, detail);
        };

        sortedTransactions.forEach(({ txn, ledgerNo }) => {
            const benefitType = classifyBrokerBenefitTransaction(txn);
            if (!benefitType) return;
            const amount = Math.abs(runtime.getTransactionAmount(txn));
            if (!(amount > 1e-9)) return;
            const currency = runtime.formatTransactionCurrency(txn) || baseCurrency;
            const ledgerDate = runtime.normalizeLedgerDate(txn?.date);
            hasNonUsdRewardSource = hasNonUsdRewardSource || currency !== 'USD';

            if (benefitType === 'kol_reward') {
                kolRewardIncome += runtime.convertAmountToBaseCurrency(
                    amount,
                    currency,
                    ledgerDate,
                    fxTimeline,
                    baseCurrency,
                );
                kolRewardRowSet.add(ledgerNo);
                return;
            }

            const sourceAmount = benefitType === 'coupon_hkd_notional' ? 100 : amount;
            const sourceCurrency = benefitType === 'coupon_hkd_notional' ? 'HKD' : currency;
            const convertedAmount = runtime.convertAmountToBaseCurrency(
                sourceAmount,
                sourceCurrency,
                ledgerDate,
                fxTimeline,
                baseCurrency,
            );
            const isCashReward = benefitType === 'cash_reward';
            const usesUsdBucket = benefitType === 'coupon_usd' || sourceCurrency === 'USD';
            hasNonUsdRewardSource = hasNonUsdRewardSource || sourceCurrency !== 'USD';

            if (isCashReward) {
                cashRewardIncome += convertedAmount;
                if (usesUsdBucket) {
                    cashRewardUsd += sourceAmount;
                    cashRewardUsdRowSet.add(ledgerNo);
                } else {
                    cashRewardHkd += sourceAmount;
                    cashRewardHkdRowSet.add(ledgerNo);
                }
            } else {
                couponRebateIncome += convertedAmount;
                if (usesUsdBucket) {
                    couponRebateUsd += sourceAmount;
                    couponRebateUsdRowSet.add(ledgerNo);
                } else {
                    couponRebateHkd += sourceAmount;
                    couponRebateHkdRowSet.add(ledgerNo);
                }
            }

            recordCouponAndCashReward({
                category: isCashReward ? 'cash_reward' : 'coupon_rebate',
                currency: sourceCurrency,
                sourceAmount,
                convertedAmount,
                ledgerNo,
            });
        });

        const couponAndCashRewardDetails = Array.from(couponAndCashRewardDetailsByKey.values())
            .sort((left, right) => {
                const leftCategoryOrder = left.category === 'coupon_rebate' ? 0 : 1;
                const rightCategoryOrder = right.category === 'coupon_rebate' ? 0 : 1;
                if (leftCategoryOrder !== rightCategoryOrder) return leftCategoryOrder - rightCategoryOrder;
                return left.currency.localeCompare(right.currency);
            })
            .map((detail) => ({
                label: `${detail.category === 'coupon_rebate' ? 'Coupon rebates' : 'Cash rewards'} · ${detail.currency}`,
                value: runtime.formatAmountWithCurrency(detail.sourceAmount, detail.currency, { showUsdSymbol: false }),
                valueClass: getSignedMetricClass(detail.sourceAmount),
            }));

        return {
            couponRebateHkd,
            couponRebateUsd,
            cashRewardHkd,
            cashRewardUsd,
            kolRewardIncome,
            couponRebateIncome,
            cashRewardIncome,
            hasNonUsdRewardSource,
            couponAndCashRewardIncome,
            hasNonUsdCouponAndCashRewardSource,
            couponAndCashRewardRows: Array.from(couponAndCashRewardRowSet),
            couponAndCashRewardDetails,
            couponRebateHkdRows: Array.from(couponRebateHkdRowSet),
            couponRebateUsdRows: Array.from(couponRebateUsdRowSet),
            cashRewardHkdRows: Array.from(cashRewardHkdRowSet),
            cashRewardUsdRows: Array.from(cashRewardUsdRowSet),
            kolRewardRows: Array.from(kolRewardRowSet),
            ...getStockGrantBenefitMetrics(safeTransactions, latestPrices, TOTAL_EQUITY),
        };
    }

function renderMetricValueCopy(metric, valueClass) {
        const value = metric?.value || '--';
        if (metric?.liveField) {
            return runtime.renderInvestmentLiveValue(metric.liveField, metric?.liveNumber, {
                className: `investment-metric-tooltip-value-copy trade-metric-value investment-stock-details-metric-value${valueClass ? ` ${valueClass}` : ''}`,
                formatter: () => value,
                useSplitValue: true,
            });
        }
        return `<span class="investment-metric-tooltip-value-copy${valueClass ? ` ${valueClass}` : ''}">${runtime.renderWorkspaceMetricValueContent(value)}</span>`;
    }

function formatInvestmentMetricTooltipRowLabel(entry) {
        if (!entry?.txn) return 'Ledger row';
        const description = String(runtime.formatTransactionDescription(entry.txn) || '').replace(/\s+/g, ' ').trim();
        return description || String(entry.txn?.description || '').replace(/\s+/g, ' ').trim() || 'Ledger row';
    }

function renderMetricValueWithTooltip(metric, { keyPrefix = '' } = {}) {
        const sortedLedgerEntries = Array.isArray(window.WORTHWARD_INVESTMENT_DATA?.transactions)
            ? [...window.WORTHWARD_INVESTMENT_DATA.transactions]
                .sort((left, right) => runtime.compareInvestmentTransactions(left, right))
                .map((txn, index) => ({
                    ledgerNo: index + 1,
                    date: String(txn?.date || ''),
                    txn,
                }))
            : [];
        const ledgerEntryMap = new Map(sortedLedgerEntries.map((entry) => [entry.ledgerNo, entry]));
        const formatTooltipLedgerDate = (rawDate) => {
            const dateParts = runtime.parseInvestmentDateParts(rawDate);
            if (!dateParts) return '';
            return runtime.formatInvestmentFullDateParts(dateParts);
        };
        const rows = Array.isArray(metric?.rows) ? [...metric.rows].sort((left, right) => right - left) : [];
        const visibleRows = rows.slice(0, 4);
        const extraCount = Math.max(0, rows.length - visibleRows.length);
        const rowListHtml = visibleRows.length
            ? `
                <ul class="investment-metric-tooltip-list">
                    ${visibleRows.map((rowNo) => `
                        <li>
                            <span class="investment-metric-tooltip-list-line">
                                <span class="investment-metric-tooltip-row-no">${runtime.escapeHtml(String(rowNo))}</span>
                                <span class="investment-metric-tooltip-row-copy">
                                    <span class="investment-metric-tooltip-row-date">${runtime.escapeHtml(formatTooltipLedgerDate(ledgerEntryMap.get(rowNo)?.date) || 'Date unavailable')}</span>
                                    <span class="investment-metric-tooltip-row-description">${runtime.escapeHtml(formatInvestmentMetricTooltipRowLabel(ledgerEntryMap.get(rowNo)))}</span>
                                </span>
                            </span>
                        </li>
                    `).join('')}
                </ul>
                ${extraCount > 0 ? `<p class="investment-metric-tooltip-note">+ ${extraCount.toLocaleString('en-US')} more ledger row${extraCount === 1 ? '' : 's'}</p>` : ''}
            `
            : `<p class="investment-metric-tooltip-note">No matching ledger rows.</p>`;
        const latestRow = rows.length ? rows[0] : '';
        const valueClass = String(metric?.valueClass || '').trim();
        const metricKey = keyPrefix ? `${keyPrefix}-${metric?.key || 'metric'}` : (metric?.key || 'metric');
        const tooltipId = `investment_metric_tooltip_${String(metricKey).replace(/[^a-z0-9_-]/gi, '_')}`;

        return `
            <span class="investment-metric-tooltip-trigger trade-metric-value${valueClass ? ` ${valueClass}` : ''}" tabindex="0" data-metric-key="${runtime.escapeHtml(metricKey)}" data-metric-target-row="${runtime.escapeHtml(String(latestRow))}" data-workspace-mask="trade-metric">
                ${renderMetricValueCopy(metric, valueClass)}
                <span id="${tooltipId}" class="investment-metric-tooltip field-tooltip liquid-glass-surface" role="tooltip" aria-hidden="true" data-investment-metric-tooltip="1">
                    <span class="investment-metric-tooltip-section">
                        <span class="investment-metric-tooltip-section-title">Calculation</span>
                        <span class="investment-metric-tooltip-copy">${runtime.escapeHtml(metric?.summary || '')}</span>
                    </span>
                    <span class="investment-metric-tooltip-section">
                        <span class="investment-metric-tooltip-section-title">Contributing ledger rows</span>
                    ${rowListHtml}
                    </span>
                </span>
            </span>
        `;
    }

function positionInvestmentMetricTooltip(trigger, tooltip) {
        if (!(trigger instanceof HTMLElement) || !(tooltip instanceof HTMLElement)) return;
        tooltip.style.left = '0px';
        tooltip.style.top = '0px';
        const triggerRect = trigger.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const viewportWidth = window.visualViewport?.width || window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0;
        const margin = 12;
        const gap = 8;
        const maxLeft = Math.max(margin, viewportWidth - tooltipRect.width - margin);
        const left = Math.min(Math.max(margin, triggerRect.left), maxLeft);
        const roomBelow = viewportHeight - triggerRect.bottom - margin;
        const roomAbove = triggerRect.top - margin;
        const shouldPlaceAbove = roomBelow < tooltipRect.height + gap && roomAbove >= tooltipRect.height + gap;
        const preferredTop = shouldPlaceAbove
            ? triggerRect.top - tooltipRect.height - gap
            : triggerRect.bottom + gap;
        const maxTop = Math.max(margin, viewportHeight - tooltipRect.height - margin);
        const top = Math.min(Math.max(margin, preferredTop), maxTop);
        tooltip.style.left = `${Math.round(left)}px`;
        tooltip.style.top = `${Math.round(top)}px`;
    }

function closeInvestmentMetricTooltip({ clearHistory = true } = {}) {
        const activeState = runtime.state.activeInvestmentMetricTooltipState;
        if (!activeState) {
            if (clearHistory) runtime.clearInvestmentHistoryHighlights();
            return;
        }
        activeState.tooltip.classList.remove('is-visible');
        activeState.tooltip.setAttribute('aria-hidden', 'true');
        activeState.trigger.removeAttribute('aria-describedby');
        window.removeEventListener('resize', activeState.reposition);
        window.removeEventListener('scroll', activeState.reposition, true);
        runtime.state.activeInvestmentMetricTooltipState = null;
        if (clearHistory) runtime.clearInvestmentHistoryHighlights();
    }

function removeInvestmentMetricTooltips() {
        closeInvestmentMetricTooltip({ clearHistory: false });
        document.querySelectorAll('[data-investment-metric-tooltip="1"]').forEach((tooltip) => tooltip.remove());
    }

function bindInvestmentMetricBreakdownControls(metricsPanel) {
        if (!(metricsPanel instanceof HTMLElement)) return;
        if (metricsPanel.dataset.investmentMetricBreakdownBound === '1') return;
        metricsPanel.dataset.investmentMetricBreakdownBound = '1';
        metricsPanel.addEventListener('click', (event) => {
            const trigger = event.target instanceof Element
                ? event.target.closest('[data-investment-metric-breakdown-trigger]')
                : null;
            if (!(trigger instanceof HTMLButtonElement) || !metricsPanel.contains(trigger)) return;
            const breakdownId = String(trigger.getAttribute('aria-controls') || '').trim();
            const breakdown = breakdownId ? document.getElementById(breakdownId) : null;
            if (!(breakdown instanceof HTMLElement) || !metricsPanel.contains(breakdown)) return;
            const shouldExpand = trigger.getAttribute('aria-expanded') !== 'true';
            const metricLabel = String(trigger.dataset.investmentMetricLabel || 'Metric');
            trigger.setAttribute('aria-expanded', String(shouldExpand));
            trigger.setAttribute('aria-label', `${shouldExpand ? 'Hide' : 'Show'} ${metricLabel} details`);
            breakdown.hidden = !shouldExpand;
        });
    }

function bindInvestmentMetricTooltipInteractions(metricsPanel) {
        if (!metricsPanel) return;
        metricsPanel.querySelectorAll('.investment-metric-tooltip-trigger').forEach((trigger) => {
            if (trigger.dataset.tooltipBound === '1') return;
            trigger.dataset.tooltipBound = '1';
            const tooltip = trigger.querySelector('[data-investment-metric-tooltip="1"]');
            if (!(tooltip instanceof HTMLElement)) return;
            document.body.appendChild(tooltip);
            const openTooltip = () => {
                closeInvestmentMetricTooltip({ clearHistory: false });
                runtime.state.activeInvestmentMetricTooltipState = {
                    trigger,
                    tooltip,
                    reposition: () => positionInvestmentMetricTooltip(trigger, tooltip),
                };
                tooltip.setAttribute('aria-hidden', 'false');
                trigger.setAttribute('aria-describedby', tooltip.id);
                tooltip.classList.add('is-visible');
                positionInvestmentMetricTooltip(trigger, tooltip);
                window.addEventListener('resize', runtime.state.activeInvestmentMetricTooltipState.reposition);
                window.addEventListener('scroll', runtime.state.activeInvestmentMetricTooltipState.reposition, true);
            };
            const closeTooltip = () => {
                if (runtime.state.activeInvestmentMetricTooltipState?.tooltip !== tooltip) return;
                closeInvestmentMetricTooltip();
            };
            const jumpToContributionRow = () => {
                const targetRowNo = Number(trigger.dataset.metricTargetRow);
                if (!Number.isFinite(targetRowNo) || targetRowNo <= 0) return;
                runtime.activateInvestmentHistoryRows([targetRowNo], { behavior: 'auto', scroll: false });
            };
            trigger.addEventListener('mouseenter', () => {
                openTooltip();
                jumpToContributionRow();
            });
            trigger.addEventListener('focus', () => {
                openTooltip();
                jumpToContributionRow();
            });
            trigger.addEventListener('mouseleave', closeTooltip);
            trigger.addEventListener('blur', closeTooltip);
        });
    }

function getNetUsdConverted(transactions) {
        return getUsdFundingMetrics(transactions).netUsdConverted;
    }

function getFundingMetricEmptyState() {
        return {
            totalDeposits: 0,
            directUsdDeposits: 0,
            netUsdConverted: 0,
            fxFundingLoss: 0,
            finalInvestableUsd: 0,
            totalCommission: 0,
            interestCharged: 0,
            directDepositRows: [],
            netUsdConvertedRows: [],
            fxFundingLossRows: [],
            finalInvestableUsdRows: [],
            totalCommissionRows: [],
            interestChargedRows: [],
        };
    }

function getFundingForexGroupKey(txn) {
        const normalizedType = runtime.getNormalizedTransactionType(txn);
        if (normalizedType !== 'forex_trade_component') return '';
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        const broker = String(txn?.broker || source?.broker || '').trim().toLowerCase();
        const account = String(txn?.account || source?.account || '').trim();
        const ledgerDate = runtime.normalizeLedgerDate(txn?.date);
        const pair = String(source?.forex_pair || txn?.ticker || '').trim().toUpperCase();
        const description = String(txn?.description || '').replace(/\s+/g, ' ').trim().toUpperCase();
        const directionMatch = description.match(/\bFX\s+FROM\s+([A-Z]{3})\s+TO\s+([A-Z]{3})\b/i);
        const reference = String(
            source?.forex_pair_reference_id
            || source?.reference_id
            || source?.execution_key?.replace(/:[A-Z]{3}$/i, '')
            || '',
        ).trim();
        const fallbackIdentity = reference || pair || (
            directionMatch
                ? `${directionMatch[1].toUpperCase()}.${directionMatch[2].toUpperCase()}`
                : description
        );
        return broker && account && ledgerDate && fallbackIdentity
            ? `${broker}|${account}|${ledgerDate}|${fallbackIdentity}`
            : '';
    }

function buildFundingForexPairIndex(sortedTransactions, baseCurrency) {
        const groups = new Map();
        sortedTransactions.forEach((entry) => {
            const groupKey = getFundingForexGroupKey(entry?.txn);
            if (!groupKey) return;
            if (!groups.has(groupKey)) groups.set(groupKey, []);
            groups.get(groupKey).push({
                ...entry,
                amount: Number(runtime.getTransactionAmount(entry.txn)),
                currency: getInvestmentMetricTransactionCurrency(entry.txn, baseCurrency),
            });
        });

        const pairByLedgerNo = new Map();
        groups.forEach((entries) => {
            const receivedBaseEntries = entries.filter((entry) => (
                entry.currency === baseCurrency
                && Number.isFinite(entry.amount)
                && entry.amount > 1e-9
            ));
            const soldNonBaseEntries = entries.filter((entry) => (
                entry.currency !== baseCurrency
                && Number.isFinite(entry.amount)
                && entry.amount < -1e-9
            ));
            if (receivedBaseEntries.length !== 1 || soldNonBaseEntries.length !== 1) return;

            const receivedEntry = receivedBaseEntries[0];
            const soldEntry = soldNonBaseEntries[0];
            const pair = {
                ownerLedgerNo: Math.min(...entries.map((entry) => entry.ledgerNo)),
                ledgerNos: entries.map((entry) => entry.ledgerNo),
                sourceCurrency: soldEntry.currency,
                sourceAmount: Math.abs(soldEntry.amount),
                receivedUsd: receivedEntry.amount,
                ledgerDate: runtime.normalizeLedgerDate(receivedEntry.txn?.date || soldEntry.txn?.date),
            };
            pair.ledgerNos.forEach((ledgerNo) => pairByLedgerNo.set(ledgerNo, pair));
        });
        return pairByLedgerNo;
    }

function getUsdFundingMetrics(transactions) {
        if (!Array.isArray(transactions)) return getFundingMetricEmptyState();

        const baseCurrency = runtime.getInvestmentBaseCurrency();
        const sortedTransactions = getSortedInvestmentMetricTransactions(transactions);
        const fxTimeline = runtime.buildInvestmentFxRateTimeline(transactions, baseCurrency);
        const fundingForexPairByLedgerNo = buildFundingForexPairIndex(sortedTransactions, baseCurrency);
        const currentDepositStreakByCurrency = new Map();
        const allDepositRows = [];
        const remainingDepositAmountsByLedgerNo = new Map();
        let totalDeposits = 0;
        let pairedDepositFunding = 0;
        let netUsdConverted = 0;
        let fxFundingLoss = 0;
        let totalCommission = 0;
        let interestCharged = 0;
        const pairedDepositRowSet = new Set();
        const netUsdConvertedRowSet = new Set();
        const fxFundingLossRowSet = new Set();
        const totalCommissionRowSet = new Set();
        const interestChargedRowSet = new Set();

        const clearCurrentDepositStreak = () => currentDepositStreakByCurrency.clear();
        const getFundingKey = (txn, currency) => [
            String(txn?.broker || txn?.source?.broker || '').trim().toLowerCase(),
            String(txn?.account || txn?.source?.account || '').trim(),
            currency,
        ].join('|');
        const getFundingTolerance = (amount) => Math.max(0.000001, Math.abs(Number(amount) || 0) * 1e-9);

        sortedTransactions.forEach(({ txn, ledgerNo }) => {
            const normalizedType = runtime.getNormalizedTransactionType(txn);
            const commissionAmount = Math.abs(runtime.getTransactionCommission(txn));
            const ledgerDate = runtime.normalizeLedgerDate(txn?.date);

            if (commissionAmount > 1e-9) {
                totalCommission += getInvestmentMetricBaseAmount(
                    commissionAmount,
                    txn,
                    fxTimeline,
                    baseCurrency,
                );
                totalCommissionRowSet.add(ledgerNo);
            }

            if (normalizedType === 'debit_interest') {
                const chargedInterest = Math.abs(runtime.getTransactionAmount(txn));
                if (chargedInterest > 1e-9) {
                    interestCharged += getInvestmentMetricBaseAmount(
                        chargedInterest,
                        txn,
                        fxTimeline,
                        baseCurrency,
                    );
                    interestChargedRowSet.add(ledgerNo);
                }
            }

            if (normalizedType === 'deposit') {
                if (runtime.isKolRewardTransaction(txn)) {
                    clearCurrentDepositStreak();
                    return;
                }
                if (
                    txn?.manual_internal_transfer_external_flow_excluded === true
                    || runtime.getInvestmentInternalTransferAggregateBridgeDelta(txn) !== 0
                ) {
                    clearCurrentDepositStreak();
                    return;
                }
                const depositAmount = runtime.getTransactionAmount(txn);
                if (Number.isFinite(depositAmount) && depositAmount > 0) {
                    const currency = getInvestmentMetricTransactionCurrency(txn, baseCurrency);
                    totalDeposits += runtime.convertAmountToBaseCurrency(
                        depositAmount,
                        currency,
                        ledgerDate,
                        fxTimeline,
                        baseCurrency,
                    );
                    const depositEntry = {
                        amount: depositAmount,
                        currency,
                        ledgerNo,
                        txn,
                    };
                    allDepositRows.push(depositEntry);
                    remainingDepositAmountsByLedgerNo.set(ledgerNo, depositAmount);
                    const fundingKey = getFundingKey(txn, currency);
                    if (!currentDepositStreakByCurrency.has(fundingKey)) {
                        currentDepositStreakByCurrency.set(fundingKey, []);
                    }
                    currentDepositStreakByCurrency.get(fundingKey).push({
                        ...depositEntry,
                        remainingAmount: depositAmount,
                    });
                }
                return;
            }

            if (normalizedType !== 'forex_trade_component') {
                clearCurrentDepositStreak();
                return;
            }

            const forexPair = fundingForexPairByLedgerNo.get(ledgerNo);
            if (!forexPair || forexPair.ownerLedgerNo !== ledgerNo) {
                return;
            }

            const fundingKey = getFundingKey(txn, forexPair.sourceCurrency);
            const candidates = currentDepositStreakByCurrency.get(fundingKey) || [];
            const availableAmount = candidates.reduce(
                (sum, entry) => sum + (Number(entry.remainingAmount) || 0),
                0,
            );
            if (availableAmount + getFundingTolerance(forexPair.sourceAmount) < forexPair.sourceAmount) {
                clearCurrentDepositStreak();
                return;
            }

            let remainingToConsume = forexPair.sourceAmount;
            let consumedFundingInBase = 0;
            candidates.forEach((entry) => {
                if (!(remainingToConsume > 1e-9) || !(entry.remainingAmount > 1e-9)) return;
                const consumedAmount = Math.min(entry.remainingAmount, remainingToConsume);
                entry.remainingAmount -= consumedAmount;
                remainingDepositAmountsByLedgerNo.set(entry.ledgerNo, entry.remainingAmount);
                remainingToConsume -= consumedAmount;
                consumedFundingInBase += runtime.convertAmountToBaseCurrency(
                    consumedAmount,
                    entry.currency,
                    forexPair.ledgerDate,
                    fxTimeline,
                    baseCurrency,
                );
                pairedDepositRowSet.add(entry.ledgerNo);
            });
            if (remainingToConsume > getFundingTolerance(forexPair.sourceAmount)) {
                clearCurrentDepositStreak();
                return;
            }

            pairedDepositFunding += consumedFundingInBase;
            netUsdConverted += forexPair.receivedUsd;
            fxFundingLoss += Math.max(0, consumedFundingInBase - forexPair.receivedUsd);
            forexPair.ledgerNos.forEach((pairLedgerNo) => {
                netUsdConvertedRowSet.add(pairLedgerNo);
                fxFundingLossRowSet.add(pairLedgerNo);
            });
        });

        const directUsdDeposits = totalDeposits - pairedDepositFunding;
        const finalInvestableUsd = directUsdDeposits + netUsdConverted;
        const directDepositRows = allDepositRows
            .map((entry) => entry.ledgerNo)
            .filter((ledgerNo) => (remainingDepositAmountsByLedgerNo.get(ledgerNo) || 0) > 1e-9);
        const netUsdConvertedRows = Array.from(netUsdConvertedRowSet);
        const fxFundingLossRows = Array.from(new Set([
            ...Array.from(pairedDepositRowSet),
            ...Array.from(fxFundingLossRowSet),
        ]));
        const finalInvestableUsdRows = Array.from(new Set([
            ...directDepositRows,
            ...netUsdConvertedRows,
        ]));

        return {
            totalDeposits,
            directUsdDeposits,
            netUsdConverted,
            fxFundingLoss,
            finalInvestableUsd,
            totalCommission,
            interestCharged,
            directDepositRows,
            netUsdConvertedRows,
            fxFundingLossRows,
            finalInvestableUsdRows,
            totalCommissionRows: Array.from(totalCommissionRowSet),
            interestChargedRows: Array.from(interestChargedRowSet),
        };
    }

    return {
        formatAmount,
        getOptionalInvestmentNumber,
        formatMetricLossAmount,
        formatMetricLossAmountWithCurrency,
        getNegativeMetricClass,
        getSignedMetricClass,
        getTotalDeposits,
        getInvestmentMetricTransactionCurrency,
        getInvestmentMetricBaseAmount,
        classifyInvestmentRealizedCashFlow,
        getInvestmentHistoricalRealizedPnl,
        getRealizedPnlAttribution,
        getHoldingsSummaryMetrics,
        getSortedInvestmentMetricTransactions,
        getSortedInvestmentTaxLotMetricTransactions,
        getLatestInvestmentMetricPrice,
        classifyBrokerBenefitTransaction,
        getStockGrantBenefitMetrics,
        getBrokerBenefitMetrics,
        renderMetricValueCopy,
        formatInvestmentMetricTooltipRowLabel,
        renderMetricValueWithTooltip,
        positionInvestmentMetricTooltip,
        closeInvestmentMetricTooltip,
        removeInvestmentMetricTooltips,
        bindInvestmentMetricBreakdownControls,
        bindInvestmentMetricTooltipInteractions,
        getNetUsdConverted,
        getFundingMetricEmptyState,
        getFundingForexGroupKey,
        buildFundingForexPairIndex,
        getUsdFundingMetrics,
    };
}

