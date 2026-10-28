/**
 * Immutable personal cost-lot snapshots for the Stock details chart.
 * Code version: v1.1.0
 */

const POSITION_EPSILON = 1e-9;
const PRICE_ORIGINS = new Set(['execution', 'carried-basis', 'grant', 'cost-basis']);

const finiteNumber = (value) => {
    if (value === null || value === undefined || typeof value === 'boolean') return null;
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !value.trim()) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};

const normalizeCurrency = (value) => String(value || '').trim().toUpperCase();

const normalizePrice = (value) => {
    const price = finiteNumber(value);
    return price !== null && price >= 0 ? price : null;
};

const quantitiesMatch = (left, right) => (
    Math.abs(left - right) <= Math.max(1e-8, Math.abs(right) * 1e-10)
);

const activeAccountingLots = (state) => (Array.isArray(state?.lots) ? state.lots : [])
    .filter((lot) => {
        const quantity = finiteNumber(lot?.quantity);
        return quantity === null || Math.abs(quantity) > POSITION_EPSILON;
    });

const validAnchorEntry = (entry) => {
    const quantity = finiteNumber(entry?.quantity);
    if (quantity === null || Math.abs(quantity) <= POSITION_EPSILON
        || !Array.isArray(entry?.parts) || !entry.parts.length) return false;
    let grossQuantity = 0;
    for (const part of entry.parts) {
        const partQuantity = finiteNumber(part?.quantity);
        if (normalizePrice(part?.price) === null || partQuantity === null || partQuantity <= 0) return false;
        grossQuantity += partQuantity;
    }
    return quantitiesMatch(grossQuantity, Math.abs(quantity));
};

const scaleAnchorParts = (parts, quantity, projectAverage = false) => {
    if (!Array.isArray(parts) || !parts.length || !(quantity > 0)) return null;
    let previousQuantity = 0;
    for (const part of parts) {
        if (normalizePrice(part?.price) === null || !(finiteNumber(part?.quantity) > 0)) return null;
        previousQuantity += Number(part.quantity);
    }
    if (!Number.isFinite(previousQuantity) || !(previousQuantity > 0)) return null;
    let allocated = 0;
    const scaled = parts.map((part, index) => {
        const nextQuantity = index === parts.length - 1
            ? quantity - allocated
            : (Number(part.quantity) / previousQuantity) * quantity;
        allocated += nextQuantity;
        return Object.freeze({
            ...part,
            price: Number(part.price),
            quantity: nextQuantity,
            ...(projectAverage ? {projection: 'proportional-survival'} : {}),
        });
    });
    return scaled.every((part) => Number.isFinite(part.quantity) && part.quantity > 0)
        ? Object.freeze(scaled)
        : null;
};

/**
 * Keep purchase-price anchors separate from mutable accounting lot basis.
 * Lot object identity remains stable across ordinary consumes and basis fixes.
 * Average-cost compression projects surviving quantities across prior purchases;
 * it does not assert which original shares the broker sold.
 */
export function reconcileInvestmentStockDetailsChipAnchors(previousTracker, accountingState, {
    openingDisplayPrice = null,
    openingOrigin = null,
    projectAverage = false,
} = {}) {
    const next = new Map();
    const lots = activeAccountingLots(accountingState);
    const previous = previousTracker instanceof Map ? previousTracker : new Map();
    if (!lots.length) return next;
    const previousEntries = Array.from(previous.values());
    if (!previousEntries.every(validAnchorEntry)) return next;
    const previousQuantity = previousEntries.reduce(
        (total, entry) => total + Math.abs(finiteNumber(entry?.quantity) ?? Number.NaN), 0,
    );
    const onlyLot = lots.length === 1 ? lots[0] : null;
    const onlyQuantity = finiteNumber(onlyLot?.quantity);
    const averageReduction = projectAverage
        && onlyLot && !previous.has(onlyLot)
        && previousEntries.length > 0
        && onlyQuantity !== null && Math.abs(onlyQuantity) > POSITION_EPSILON
        && Math.abs(onlyQuantity) < previousQuantity
        && previousEntries.every((entry) => Math.sign(entry?.quantity) === Math.sign(onlyQuantity));
    if (averageReduction) {
        const parts = scaleAnchorParts(
            previousEntries.flatMap((entry) => entry.parts || []), Math.abs(onlyQuantity), true,
        );
        if (parts) next.set(onlyLot, Object.freeze({quantity: onlyQuantity, parts}));
        return next;
    }

    const openingPrice = normalizePrice(openingDisplayPrice);
    lots.forEach((lot) => {
        const quantity = finiteNumber(lot?.quantity);
        const costPrice = normalizePrice(lot?.unitPrice);
        if (quantity === null || Math.abs(quantity) <= POSITION_EPSILON || costPrice === null) return;
        const prior = previous.get(lot);
        let parts;
        if (prior && Math.sign(prior.quantity) === Math.sign(quantity)) {
            parts = scaleAnchorParts(prior.parts, Math.abs(quantity));
        } else {
            parts = Object.freeze([Object.freeze({
                price: openingPrice ?? costPrice,
                quantity: Math.abs(quantity),
                origin: PRICE_ORIGINS.has(openingOrigin)
                    ? openingOrigin
                    : openingPrice === null ? 'carried-basis' : 'execution',
            })]);
        }
        if (parts) next.set(lot, Object.freeze({quantity, parts}));
    });
    return next;
}

/** Return copied display prices with current accounting costs, or fail closed. */
export function buildInvestmentStockDetailsChipDisplayParts(state, tracker) {
    if (!(tracker instanceof Map)) return null;
    const lots = activeAccountingLots(state);
    if (tracker.size !== lots.length) return null;
    const parts = [];
    for (const lot of lots) {
        const quantity = finiteNumber(lot?.quantity);
        const costPrice = normalizePrice(lot?.unitPrice);
        const entry = tracker.get(lot);
        if (quantity === null || costPrice === null || !entry
            || !quantitiesMatch(finiteNumber(entry.quantity) ?? Number.NaN, quantity)
            || !Array.isArray(entry.parts) || !entry.parts.length) return null;
        let partQuantity = 0;
        for (const part of entry.parts) {
            const displayPrice = normalizePrice(part?.price);
            const grossQuantity = finiteNumber(part?.quantity);
            if (displayPrice === null || grossQuantity === null || grossQuantity <= 0) return null;
            partQuantity += grossQuantity;
            parts.push(Object.freeze({
                price: displayPrice,
                costPrice,
                quantity: Math.sign(quantity) * grossQuantity,
                origin: part.origin,
                ...(part.projection ? {projection: part.projection} : {}),
            }));
        }
        if (!quantitiesMatch(partQuantity, Math.abs(quantity))) return null;
    }
    return Object.freeze(parts);
}

const priceBin = (bin, price) => {
    const direction = bin.side === 'long' ? 1 : -1;
    const unrealizedPnl = price === null ? null : direction * (price - (bin.costPrice ?? bin.price)) * bin.quantity;
    return Object.freeze({
        ...bin,
        profitable: unrealizedPnl === null ? null : unrealizedPnl >= 0,
        unrealizedPnl,
    });
};

export function repriceInvestmentStockDetailsChipSnapshot(snapshot, price) {
    const currentPrice = normalizePrice(price);
    return Object.freeze({
        ...snapshot,
        price: currentPrice,
        positionCurrencies: Object.freeze([...snapshot.positionCurrencies]),
        bins: Object.freeze(snapshot.bins.map((bin) => priceBin(bin, currentPrice))),
    });
}

/**
 * Copy remaining replay lots without reconstructing missing inventory.
 * A partial-history source flag does not itself make known open basis unknown.
 */
export function buildInvestmentStockDetailsChipSnapshot(scopedStates, {
    date = '',
    price = null,
    quoteCurrency = '',
    priceAnchorsByState = null,
} = {}) {
    const requestedCurrency = normalizeCurrency(quoteCurrency);
    const currentPrice = normalizePrice(price);
    const states = scopedStates instanceof Map
        ? Array.from(scopedStates.values())
        : (Array.isArray(scopedStates) ? scopedStates : []);
    const currencies = new Set();
    const copiedLots = [];
    let totalQuantity = 0;
    let signedQuantity = 0;
    let hasPartialTaxLotHistory = false;
    let accountingTotalCost = 0;
    let reason = null;

    states.forEach((state) => {
        if (!state || typeof state !== 'object') {
            reason ||= 'invalid-lots';
            return;
        }
        const shares = finiteNumber(state.shares);
        if (shares === null) {
            reason ||= 'invalid-lots';
            return;
        }
        const activeLots = (Array.isArray(state.lots) ? state.lots : [])
            .filter((lot) => {
                const quantity = finiteNumber(lot?.quantity);
                return quantity === null || Math.abs(quantity) > POSITION_EPSILON;
            });
        if (Math.abs(shares) <= POSITION_EPSILON) {
            if (activeLots.length) reason ||= 'incomplete-lots';
            return;
        }
        totalQuantity += Math.abs(shares);
        signedQuantity += shares;
        hasPartialTaxLotHistory ||= state.hasPartialTaxLotHistory === true;
        const currency = normalizeCurrency(state.lotScope?.currency) || requestedCurrency;
        if (currency) currencies.add(currency);
        else reason ||= 'unknown-currency';
        if (state.costBasisStatus !== 'known') {
            reason ||= state.costBasisStatus === 'partial' ? 'partial-basis' : 'unknown-basis';
        }
        let lotQuantity = 0;
        let lotCost = 0;
        const accountingLots = [];
        activeLots.forEach((lot) => {
            const quantity = finiteNumber(lot?.quantity);
            const unitPrice = finiteNumber(lot?.unitPrice);
            if (
                quantity === null
                || unitPrice === null
                || unitPrice < 0
                || Math.sign(quantity) !== Math.sign(shares)
            ) {
                reason ||= 'invalid-lots';
                return;
            }
            lotQuantity += quantity;
            lotCost += Math.abs(quantity) * unitPrice;
            accountingLots.push({price: unitPrice, quantity});
        });
        if (!quantitiesMatch(lotQuantity, shares)) reason ||= 'incomplete-lots';
        if (state.totalCost !== undefined) {
            const stateCost = finiteNumber(state.totalCost);
            if (
                stateCost === null
                || stateCost < 0
                || Math.abs(lotCost - stateCost) > Math.max(1e-7, Math.abs(stateCost) * 1e-9)
            ) {
                reason ||= 'incomplete-lots';
            }
        }
        accountingTotalCost += lotCost;
        if (priceAnchorsByState?.has(state)) {
            const displayParts = buildInvestmentStockDetailsChipDisplayParts(state, priceAnchorsByState.get(state));
            if (displayParts) copiedLots.push(...displayParts);
            else reason ||= 'incomplete-price-anchors';
        } else {
            copiedLots.push(...accountingLots.map((lot) => priceAnchorsByState
                ? {...lot, costPrice: lot.price, origin: 'cost-basis'}
                : lot));
        }
    });

    const positionCurrencies = Object.freeze(Array.from(currencies).sort());
    if (!Number.isFinite(totalQuantity) || !Number.isFinite(signedQuantity)) reason ||= 'invalid-lots';
    if (positionCurrencies.length > 1) reason = 'mixed-currencies';
    else if (requestedCurrency && positionCurrencies[0] && requestedCurrency !== positionCurrencies[0]) {
        reason = 'currency-mismatch';
    }
    const baseSnapshot = {
        date: String(date || ''),
        price: currentPrice,
        currency: positionCurrencies[0] || requestedCurrency,
        positionCurrencies,
        hasPartialTaxLotHistory,
        totalQuantity,
        signedQuantity,
    };
    if (reason || totalQuantity <= POSITION_EPSILON) {
        return Object.freeze({
            ...baseSnapshot,
            status: reason ? 'unavailable' : 'empty',
            reason,
            bins: Object.freeze([]),
            totalCost: reason ? null : 0,
            weightedAverageCost: null,
            maxQuantity: 0,
        });
    }

    const groupedLots = new Map();
    copiedLots.forEach((lot) => {
        const side = lot.quantity > 0 ? 'long' : 'short';
        const costPrice = lot.costPrice ?? lot.price;
        const key = `${side}:${lot.price}:${costPrice}:${lot.origin || ''}`;
        if (!groupedLots.has(key)) groupedLots.set(key, {
            price: lot.price, side, quantity: 0,
            ...(lot.costPrice !== undefined ? {costPrice} : {}),
            ...(lot.origin ? {priceOrigin: lot.origin} : {}),
        });
        const group = groupedLots.get(key);
        group.quantity += Math.abs(lot.quantity);
        if (lot.projection) group.displayPriceProjection = lot.projection;
    });
    const groupedBins = Array.from(groupedLots.values())
        .sort((left, right) => left.price - right.price || left.side.localeCompare(right.side));
    const maxQuantity = groupedBins.reduce((maximum, bin) => Math.max(maximum, bin.quantity), 0);
    const totalCost = accountingTotalCost;
    const bins = Object.freeze(groupedBins.map((bin) => {
        const direction = bin.side === 'long' ? 1 : -1;
        return priceBin({
            ...bin,
            signedQuantity: direction * bin.quantity,
            weight: bin.quantity / totalQuantity,
            normalizedWidth: bin.quantity / maxQuantity,
        }, currentPrice);
    }));
    return Object.freeze({
        ...baseSnapshot,
        status: 'ready',
        reason: null,
        bins,
        totalCost,
        weightedAverageCost: totalCost / totalQuantity,
        maxQuantity,
    });
}
