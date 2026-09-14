/* Code version: v1.0.0 */
/** Pure Stock-details range, session, and realized-P&L timeline helpers. */

export function getInvestmentStockDetailsAveragePriceLabel() {
    return 'Average price';
}

const INVESTMENT_DATE_ONLY_TRANSACTION_FILE_KINDS = new Set([
    'hsbc_order_status_capture',
    'hsbc_order_status_text',
]);

export function isInvestmentTransactionDateOnly(transaction) {
    const source = transaction?.source;
    const sourceTimestampFlag = source?.source_has_intraday_timestamp;
    if (sourceTimestampFlag === false || String(sourceTimestampFlag).trim().toLowerCase() === 'false') {
        return true;
    }
    if (sourceTimestampFlag === true || String(sourceTimestampFlag).trim().toLowerCase() === 'true') {
        return false;
    }
    return INVESTMENT_DATE_ONLY_TRANSACTION_FILE_KINDS.has(
        String(source?.file_kind || '').trim().toLowerCase(),
    );
}

export function getInvestmentStockDetailsTransactionSessionType(
    transaction,
    datetimeValue,
    getTradeSessionType = getInvestmentTradeSessionType,
) {
    if (isInvestmentTransactionDateOnly(transaction)) return 'intraday';
    return getTradeSessionType(datetimeValue);
}

export function normalizeInvestmentRange(range, options = [], fallback = 'max') {
    const normalizedRange = String(range || '').trim().toLowerCase();
    return options.some((option) => option?.value === normalizedRange)
        ? normalizedRange
        : fallback;
}

export function isInvestmentStockDetailsIntradayRange(range, options = []) {
    return normalizeInvestmentRange(range, options) === '1w';
}

export function normalizeInvestmentStockDetailsIntradayRows(rows = []) {
    return (Array.isArray(rows) ? rows : [])
        .map((row) => {
            if (!row || typeof row !== 'object') return null;
            const date = String(row.date || '').trim();
            const open = Number(row.open);
            const high = Number(row.high);
            const low = Number(row.low);
            const close = Number(row.close);
            const prices = [open, high, low, close];
            if (!date || !prices.every(Number.isFinite) || prices.some((value) => value <= 0)) {
                return null;
            }
            if (
                high < Math.max(open, close)
                || low > Math.min(open, close)
                || high < low
            ) {
                return null;
            }
            return {
                ...row,
                date,
                open,
                high,
                low,
                close,
            };
        })
        .filter(Boolean);
}

export function parseInvestmentIntradayTimestamp(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (!match) return null;
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const hours = Number(match[4]);
    const minutes = Number(match[5]);
    if (![year, monthIndex, day, hours, minutes].every(Number.isFinite)) return null;
    return new Date(year, monthIndex, day, hours, minutes, 0, 0);
}

export function normalizeInvestmentIntradayMinuteKey(value) {
    const parsed = parseInvestmentIntradayTimestamp(value);
    if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) return '';
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    const hours = String(parsed.getHours()).padStart(2, '0');
    const minutes = String(parsed.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function buildInvestmentIntradayDayFallbackIndex(labels = [], normalizeDate = (value) => value) {
    return (Array.isArray(labels) ? labels : []).reduce((accumulator, label, index) => {
        const dayKey = normalizeDate(label);
        if (dayKey) accumulator.set(dayKey, index);
        return accumulator;
    }, new Map());
}

export function buildInvestmentIntradayDayBoundaries(labels = [], normalizeDate = (value) => value) {
    const orderedDays = [];
    const dayMap = new Map();
    (Array.isArray(labels) ? labels : []).forEach((label, index) => {
        const dayKey = normalizeDate(label);
        if (!dayKey) return;
        const existing = dayMap.get(dayKey);
        if (existing) {
            existing.lastIndex = index;
            return;
        }
        const entry = {
            dayKey,
            ordinal: orderedDays.length,
            firstIndex: index,
            lastIndex: index,
        };
        orderedDays.push(entry);
        dayMap.set(dayKey, entry);
    });
    return {orderedDays, dayMap};
}

export function resolveInvestmentStockDetailsDailySnapshotIndex(
    ledgerDate,
    labels = [],
    normalizeDate = (value) => String(value || '').slice(0, 10),
) {
    const normalizedLedgerDate = normalizeDate(ledgerDate);
    const normalizedLabels = Array.isArray(labels) ? labels : [];
    if (!normalizedLedgerDate || !normalizedLabels.length) return null;
    const firstVisibleDate = normalizeDate(normalizedLabels[0]);
    if (!firstVisibleDate || normalizedLedgerDate < firstVisibleDate) return null;
    for (let index = 0; index < normalizedLabels.length; index += 1) {
        const visibleDate = normalizeDate(normalizedLabels[index]);
        if (visibleDate && visibleDate >= normalizedLedgerDate) return index;
    }
    return null;
}

export function buildInvestmentStockDetailsRealizedPnlTimeline(
    realizedPnlByDate = {},
    normalizeDate = (value) => String(value || '').slice(0, 10),
) {
    return Object.entries(realizedPnlByDate || {})
        .map(([rawDate, rawValue]) => ({
            date: normalizeDate(rawDate),
            value: Number(rawValue),
        }))
        .filter((entry) => entry.date && Number.isFinite(entry.value))
        .sort((left, right) => left.date.localeCompare(right.date));
}

export function resolveInvestmentStockDetailsCumulativeRealizedPnl(
    realizedPnlTimeline = [],
    targetDate,
) {
    const normalizedTargetDate = String(targetDate || '').slice(0, 10);
    if (!normalizedTargetDate || !Array.isArray(realizedPnlTimeline)) return null;
    return realizedPnlTimeline.reduce(
        (total, entry) => entry?.date <= normalizedTargetDate ? total + Number(entry.value || 0) : total,
        0,
    );
}

export function getInvestmentTradeSessionType(value, parseDateParts) {
    const dateParts = parseDateParts(value);
    if (!dateParts || !Number.isInteger(dateParts.hours) || !Number.isInteger(dateParts.minutes)) {
        return 'intraday';
    }
    const totalMinutes = (dateParts.hours * 60) + dateParts.minutes;
    const intradayOpenMinutes = (9 * 60) + 30;
    const intradayCloseMinutes = 16 * 60;
    const premarketOpenMinutes = 4 * 60;
    const postmarketCloseMinutes = 20 * 60;
    if (totalMinutes >= intradayOpenMinutes && totalMinutes < intradayCloseMinutes) return 'intraday';
    if (totalMinutes >= premarketOpenMinutes && totalMinutes < intradayOpenMinutes) return 'pre';
    if (totalMinutes >= intradayCloseMinutes && totalMinutes < postmarketCloseMinutes) return 'post';
    return 'night';
}

export function resolveInvestmentStockDetailsTrailingOffHoursAnchorDayKey(
    transaction,
    sessionType,
    lastVisibleDayKey,
) {
    const normalizedSessionType = String(sessionType || '').trim().toLowerCase();
    const normalizedLastVisibleDayKey = String(lastVisibleDayKey || '').trim().slice(0, 10);
    const ledgerDate = String(transaction?.date || '').trim().slice(0, 10);
    if (
        !['night', 'pre'].includes(normalizedSessionType)
        || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedLastVisibleDayKey)
        || !/^\d{4}-\d{2}-\d{2}$/.test(ledgerDate)
    ) {
        return '';
    }
    if (ledgerDate > normalizedLastVisibleDayKey) return normalizedLastVisibleDayKey;
    if (ledgerDate !== normalizedLastVisibleDayKey || normalizedSessionType !== 'night') return '';
    const datetimeValue = String(transaction?.datetime || transaction?.date || '').trim();
    const datetimeMatch = datetimeValue.match(/^\d{4}-\d{2}-\d{2}(?:[T ](\d{2}):(\d{2}))/);
    const hour = datetimeMatch ? Number(datetimeMatch[1]) : null;
    const minute = datetimeMatch ? Number(datetimeMatch[2]) : null;
    return Number.isInteger(hour) && Number.isInteger(minute) && (hour * 60) + minute >= 20 * 60
        ? normalizedLastVisibleDayKey
        : '';
}
