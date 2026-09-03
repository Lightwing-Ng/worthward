/**
 * Investment stock details helpers.
 *
 * Code version: v0.27.0
 * - Refactored: Investment y-axis badges now delegate to the shared chart-axis
 *   primitive while preserving the existing exported compatibility wrapper.
 * - Changed: Stock-details price-axis labels now reuse the shared grouped
 *   integer and sub-100 two-decimal display contract.
 * - Changed: Stock details imports the browser replay and linked-distribution
 *   display contract used by the Investment transaction history.
 * - Fixed: Average-price chart points and tooltip snapshots now use the
 *   configured cost-basis replay, with the latest point aligned to the
 *   authoritative ticker-summary cost basis when available.
 * - Changed: The shared investment data-utils dependency now uses the current
 *   cash-resolver cache key.
 * - Changed: Buy and sell trades now render as volume-scaled glowing zones;
 *   nearby same-side markers use distance-weighted fluid adhesion bridges
 *   while each transaction center remains anchored to its exact price.
 * - Changed: Glow marker radii, adhesion distance, bridge width, opacity, and
 *   blur are reduced so dense ranges stay visually lightweight.
 * - Changed: Same-side Glow bridges now pass through a price-path trend gate;
 *   links that cut across a material reversal or deep V/inverted-V are omitted.
 * - Changed: Glow links now form weighted connected zones with smooth nonlinear
 *   boundaries; weak or singleton groups remain as isolated marker cores.
 * - Changed: Connected zones now use center-weighted radial fades with no
 *   border stroke; the zone edge resolves to fully transparent.
 * - Changed: Individual trade origins now reuse the original center-out
 *   radial fade, with marker area scaled by the visible range's transaction
 *   amount maximum rather than a workspace-wide quantity maximum.
 * - Changed: Connected zones now render a capped inverse-square intensity
 *   field, summing each connected trade amount over its squared distance
 *   instead of compositing circular blobs.
 * - Changed: Connected inverse-square fields now use a stronger visual gain
 *   so nearby same-side origins receive a visible continuous buffer while
 *   the underlying intensity formula remains unchanged.
 * - Fixed: Pure-trade realized P&L breakdowns now use the shared broker-scoped
 *   summary so Stock details cannot diverge from Holdings calibration.
 * - Fixed: Stock-details intraday trade markers retain off-hours buys that
 *   occur after the last visible regular-session candle, placing them in the
 *   trailing overnight or pre-market gap.
 * - Fixed: Stock-details off-hours markers restore the established gap
 *   placement instead of snapping to a regular-session candle.
 * - Changed: Stock-details Average price labels stay presentation-neutral;
 *   cost-method details remain internal calculation metadata and are omitted
 *   from the metric, chart dataset, and tooltip.
 * - Fixed: Stock-details labels now read the shared global cost-method
 *   resolver directly, so transfer-basis metadata cannot be passed as the
 *   active matcher by a caller.
 * - Changed: The Stock-details tooltip and chart dataset expose the same
 *   selected matcher label as the Average price metric.
 * - Fixed: Stock-details average-price labels now follow the configured global
 *   sell-matching method; FIFO reconstructed remains a separate transfer-basis
 *   detail instead of replacing the selected method.
 * - Fixed: Stock-details now requests the current shared data-utilities
 *   module so HSBC realized P&L cannot regress through a stale browser cache.
 * - Fixed: Stock grants, including IBKR grants, remain zero-cost lots and do
 *   not contribute to Stock-details trade counts.
 * - Refactored: Stock-details and Overview charts now share the same blue
 *   rounded y-axis value badge renderer.
 * - Changed: Stock details imports the current data-utilities revision so its
 *   shared scoped-position aggregation cannot retain a stale module cache.
 * - Changed: Stock details imports the corrected money-market and
 *   cash-equivalent classification contract.
 * - Added: Realized P&L breakdowns retain broker attribution so multi-broker
 *   tickers can show the HSBC and IBKR contributions separately.
 * - Changed: Stock details imports the settlement-boundary-aware Investment
 *   data-utilities revision used by the Overview replay.
 * - Fixed: Stock details imports open-position tax-lot attestation support from
 *   the current Investment data-utilities revision.
 * - Fixed: Stock details now imports the current Investment data-utilities
 *   revision used by the dated Overview replay and valuation guards.
 * - Fixed: Stock details now imports the current Investment data-utilities revision after the HSBC settlement replay presentation fix.
 * - Fixed: Stock-details tax-lot replay uses source execution timestamps for same-day HSBC trades and attested open-position history.
 * - Fixed: Stock-details intraday charts ignore non-positive or structurally invalid OHLC bars.
 * - Changed: Stock-details hover guides reuse the shared soft muted gray token.
 * - Refactored: Average-cost chart aggregation now reuses the shared scoped-position aggregation contract from data-utils.
 * - Fixed: Average-cost chart points now replay each broker/account/currency lot scope before aggregating the visible position, so cross-account sells cannot consume unrelated lots.
 * - Changed: Average-cost aggregation returns no curve for a ticker whose visible lots use multiple currencies rather than summing raw currency units.
 * - Refactored: Stock-details rows, broker metrics, and average-cost charts now use the shared transaction applier for trades, grants, and transfers.
 * - Changed: Stock-details exact-price hover badges now reuse the Holdings allocation badge corner radius while preserving their existing blue fill and alignment.
 * - Fixed: Stock-details hover guides span the complete chart area instead of stopping at the average-cost curve.
 * - Fixed: Daily stock-details replay carries weekend and market-holiday position changes to the next visible market close.
 * - Fixed: Stock-detail trade replay uses broker-account tax-lot scopes and displays broker-reported realized P&L when present.
 * - Refactored: Range, intraday-minute, day-boundary, and trade-session rules are exported for direct unit testing.
 * - Fixed: Eligible live markers keep the final chart x-position while resolving their y-position and y-scale from the current realtime quote price.
 * - Fixed: Mixed integer and fractional y-axis ticks now select a fractional tick when resolving the shared decimal anchor.
 * - Fixed: Exact-price badges now reuse the rendered y-axis label anchor and font so integer and decimal columns align with the covered tick labels.
 * - Added: Stock-details hover now draws a cost-curve-bounded horizontal guide beneath chart data and a blue exact-price badge over the y-axis labels.
 * - Changed: Stock-details charts no longer reserve top canvas padding for the range control now that the control has its own layout track.
 * - Changed: Stock-details price chart x-axis date labels now use weight 400 while preserving the existing font and size.
 * - Changed: Stock-details 1W x-axis labels now center each trading date within its intraday session and omit intraday times.
 * - Fixed: Stock-details intraday trade markers no longer project pre-range overnight trades onto the first visible candle.
 * - Fixed: Stock-details intraday average-price curves no longer draw solid point markers on cost-change indexes.
 * - Changed: Stock-details intraday average-price curves now render as event-stepped cost lines with subtle change points so each trade-driven cost update is visible.
 * - Fixed: Stock-details overnight trades at or after 20:00 now prefer the next visible intraday session's first candle before falling back to the ledger date.
 * - Fixed: Date-only HSBC order-status trades now anchor to the same day's regular-session close instead of being discarded as synthetic 20:00 overnight trades.
 * - Changed: Stock-details 1W uses regular-session 1-minute candles outside realtime sessions and anchors off-hours trade markers to the nearest session candle.
 * - Fixed: Broker metric replay now builds its own rendered split-factor hints instead of reading a stock-detail row-local variable.
 * - Fixed: Stock-details transaction replay now shares rendered split-factor hints with zero-price grant rows.
 * - Added: Exported module version metadata so the investment entry module can expose loaded helper versions for cache diagnostics.
 * - Fixed: Stock details now uses canonical investment tickers so MSFT.US and MSFT share one transaction history, broker metric set, and price chart.
 * - Fixed: Stock-details price chart axis labels now dedupe same-day ticks and reserve a stable today slot during live sessions so refresh and live polling no longer shift the plotted range.
 * - Fixed: Stock-details intraday candles and live pulse now stay off outside active realtime sessions.
 * - Added: Stock-details price chart rendering can notify the parent investment page after the canvas is ready for share preview refreshes
 * - Added: Stock-details price chart now reuses the DOM-based live pulse marker, so eligible ranges no longer need canvas-side pulse painting
 * - Fixed: Average-price chart replay now uses the same split-adjusted quantities as holdings, so fully closed historical positions leave a real gap instead of a residual cost line.
 * - Fixed: Aggregate stock-detail replay recognizes in-kind transfers as non-cash share movements.
 * - Added: Stock-details chart hover tooltips now expose date-scoped realized and unrealized P&L using the shared base-currency accounting contract.
 */

import {
    aggregateInvestmentScopedPositionStates,
} from './data-utils.js?v=investment-data-utils-v1.109.0';

const aggregateInvestmentStockDetailPositionStates = aggregateInvestmentScopedPositionStates;

export const INVESTMENT_STOCK_DETAILS_MODULE_VERSION = 'v0.27.0';

export const INVESTMENT_TRADE_MARKER_MAX_RADIUS_PX = 8;
export const INVESTMENT_TRADE_MARKER_GLOW_MAX_DISTANCE_PX = 44;
export const INVESTMENT_TRADE_MARKER_GLOW_MAX_NEIGHBORS = 2;
export const INVESTMENT_TRADE_MARKER_GLOW_SAFE_PADDING_PX = 20;
export const INVESTMENT_TRADE_MARKER_GLOW_MAX_PATH_DEVIATION_RATIO = 0.012;
export const INVESTMENT_TRADE_MARKER_GLOW_TREND_TOLERANCE_RATIO = 0.0015;
export const INVESTMENT_TRADE_MARKER_GLOW_ZONE_MIN_STRENGTH = 0.18;
export const INVESTMENT_TRADE_MARKER_GLOW_ZONE_BOUNDARY_SAMPLES = 24;
export const INVESTMENT_TRADE_MARKER_GLOW_ZONE_EDGE_PADDING_PX = 2.5;
export const INVESTMENT_TRADE_MARKER_GLOW_ZONE_FIELD_SOFTENING_PX = 2.5;
export const INVESTMENT_TRADE_MARKER_GLOW_ZONE_FIELD_THRESHOLD = 1;
export const INVESTMENT_TRADE_MARKER_GLOW_ZONE_FIELD_RESOLUTION = 0.5;
export const INVESTMENT_TRADE_MARKER_GLOW_ZONE_FIELD_VISUAL_GAIN = 2.2;

export function resolveInvestmentTradeMarkerRadius(
    amount,
    maxAmount,
    maxRadius = INVESTMENT_TRADE_MARKER_MAX_RADIUS_PX,
) {
    const normalizedAmount = Math.abs(Number(amount));
    const normalizedMaxAmount = Math.abs(Number(maxAmount));
    const normalizedMaxRadius = Number(maxRadius);
    if (
        !Number.isFinite(normalizedAmount)
        || normalizedAmount <= 0
        || !Number.isFinite(normalizedMaxAmount)
        || normalizedMaxAmount <= 0
        || !Number.isFinite(normalizedMaxRadius)
        || normalizedMaxRadius <= 0
    ) {
        return 0;
    }
    return normalizedMaxRadius * Math.sqrt(
        Math.min(normalizedAmount, normalizedMaxAmount) / normalizedMaxAmount,
    );
}

function resolveInvestmentTradeMarkerColorWithAlpha(color, alpha) {
    const normalizedColor = String(color || '').trim();
    const normalizedAlpha = Number(alpha);
    if (!normalizedColor || !Number.isFinite(normalizedAlpha)) return normalizedColor;
    const clampedAlpha = Math.min(1, Math.max(0, normalizedAlpha));
    const hexMatch = normalizedColor.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i);
    if (hexMatch) {
        const rawHex = hexMatch[1];
        const expandedHex = rawHex.length === 3
            ? rawHex.split('').map((char) => `${char}${char}`).join('')
            : rawHex;
        const red = parseInt(expandedHex.slice(0, 2), 16);
        const green = parseInt(expandedHex.slice(2, 4), 16);
        const blue = parseInt(expandedHex.slice(4, 6), 16);
        return `rgba(${red}, ${green}, ${blue}, ${clampedAlpha})`;
    }
    const rgbMatch = normalizedColor.match(/^rgba?\(([^)]+)\)$/i);
    if (rgbMatch) {
        const channels = rgbMatch[1].split(',').slice(0, 3).map((value) => value.trim());
        if (channels.length === 3) return `rgba(${channels.join(', ')}, ${clampedAlpha})`;
    }
    return normalizedColor;
}

export function drawInvestmentTradeMarkerCircle(ctx, {
    x,
    y,
    radius,
    opaqueColor,
    transparentColor,
} = {}) {
    if (
        !ctx
        || !Number.isFinite(x)
        || !Number.isFinite(y)
        || !Number.isFinite(radius)
        || radius <= 0
        || !opaqueColor
        || !transparentColor
    ) {
        return false;
    }
    ctx.save();
    const gradient = typeof ctx.createRadialGradient === 'function'
        ? ctx.createRadialGradient(x, y, 0, x, y, radius)
        : null;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    if (gradient) {
        gradient.addColorStop(0, opaqueColor);
        gradient.addColorStop(1, transparentColor);
        ctx.fillStyle = gradient;
    } else {
        ctx.fillStyle = opaqueColor;
    }
    ctx.fill();
    ctx.restore();
    return true;
}

function normalizeInvestmentTradeMarkerGlowPoints(markers) {
    return (Array.isArray(markers) ? markers : [])
        .map((marker, index) => ({
            marker,
            index,
            x: Number(marker?.x),
            y: Number(marker?.y),
            radius: Number(marker?.radius),
            amount: Math.abs(Number(marker?.amount)),
            type: String(marker?.type || '').trim().toLowerCase(),
        }))
        .filter((point) => (
            Number.isFinite(point.x)
            && Number.isFinite(point.y)
            && Number.isFinite(point.radius)
            && point.radius > 0
        ))
        .map((point, index) => ({...point, index}));
}

function resolveInvestmentTradeMarkerGlowPointAmount(point) {
    const amount = Math.abs(Number(point?.amount ?? point?.marker?.amount));
    if (Number.isFinite(amount) && amount > 0) return amount;
    const radius = Math.abs(Number(point?.radius));
    return Number.isFinite(radius) && radius > 0 ? radius ** 2 : 0;
}

export function resolveInvestmentTradeMarkerGlowZoneFieldIntensity(
    x,
    y,
    points,
    maxAmount,
    {
        softeningPx = INVESTMENT_TRADE_MARKER_GLOW_ZONE_FIELD_SOFTENING_PX,
        threshold = INVESTMENT_TRADE_MARKER_GLOW_ZONE_FIELD_THRESHOLD,
    } = {},
) {
    const normalizedX = Number(x);
    const normalizedY = Number(y);
    const normalizedMaxAmount = Math.abs(Number(maxAmount));
    const normalizedSoftening = Number(softeningPx);
    const normalizedThreshold = Number(threshold);
    if (
        !Number.isFinite(normalizedX)
        || !Number.isFinite(normalizedY)
        || !Number.isFinite(normalizedMaxAmount)
        || normalizedMaxAmount <= 0
        || !Number.isFinite(normalizedSoftening)
        || normalizedSoftening <= 0
        || !Number.isFinite(normalizedThreshold)
        || normalizedThreshold <= 0
    ) {
        return 0;
    }
    const softeningSquared = normalizedSoftening ** 2;
    const sigma = (Array.isArray(points) ? points : []).reduce((sum, point) => {
        const pointX = Number(point?.x);
        const pointY = Number(point?.y);
        const amount = resolveInvestmentTradeMarkerGlowPointAmount(point);
        if (
            !Number.isFinite(pointX)
            || !Number.isFinite(pointY)
            || !Number.isFinite(amount)
            || amount <= 0
        ) {
            return sum;
        }
        const distanceSquared = Math.max(
            softeningSquared,
            ((normalizedX - pointX) ** 2) + ((normalizedY - pointY) ** 2),
        );
        return sum + (
            (amount / normalizedMaxAmount)
            * (softeningSquared / distanceSquared)
        );
    }, 0);
    return Math.min(
        normalizedThreshold,
        Math.max(0, sigma / normalizedThreshold),
    );
}

function resolveInvestmentTradeMarkerGlowPrice(point, priceValues) {
    const markerPrice = Number(
        point?.marker?.price
        ?? point?.marker?.tradePrice
        ?? point?.marker?.value,
    );
    if (Number.isFinite(markerPrice) && markerPrice > 0) return markerPrice;
    const sourceIndex = Number(point?.marker?.index);
    const seriesPrice = Array.isArray(priceValues) && Number.isInteger(sourceIndex)
        ? Number(priceValues[sourceIndex])
        : Number.NaN;
    return Number.isFinite(seriesPrice) && seriesPrice > 0 ? seriesPrice : null;
}

function isInvestmentTradeMarkerGlowPathCompatible(
    from,
    to,
    priceValues,
    {
        maxPathDeviationRatio = INVESTMENT_TRADE_MARKER_GLOW_MAX_PATH_DEVIATION_RATIO,
        trendToleranceRatio = INVESTMENT_TRADE_MARKER_GLOW_TREND_TOLERANCE_RATIO,
    } = {},
) {
    if (!Array.isArray(priceValues) || !priceValues.length) return true;
    const fromIndex = Number(from?.marker?.index);
    const toIndex = Number(to?.marker?.index);
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return true;
    if (fromIndex === toIndex) return true;

    const fromPrice = resolveInvestmentTradeMarkerGlowPrice(from, priceValues);
    const toPrice = resolveInvestmentTradeMarkerGlowPrice(to, priceValues);
    if (!Number.isFinite(fromPrice) || !Number.isFinite(toPrice)) return false;

    const path = [];
    const indexStep = fromIndex < toIndex ? 1 : -1;
    for (let index = fromIndex; ; index += indexStep) {
        const seriesPrice = Number(priceValues[index]);
        const pathValue = index === fromIndex ? fromPrice : index === toIndex ? toPrice : seriesPrice;
        if (!Number.isFinite(pathValue) || pathValue <= 0) return false;
        path.push(pathValue);
        if (index === toIndex) break;
    }
    if (path.length <= 2) return true;

    const baselinePrice = Math.max(1, ...path.map((value) => Math.abs(value)));
    const normalizedToleranceRatio = Number(trendToleranceRatio);
    const movementTolerance = Math.max(
        0.01,
        baselinePrice * (Number.isFinite(normalizedToleranceRatio) && normalizedToleranceRatio >= 0
            ? normalizedToleranceRatio
            : INVESTMENT_TRADE_MARKER_GLOW_TREND_TOLERANCE_RATIO),
    );
    const expectedDelta = (toPrice - fromPrice) / (path.length - 1);
    const direction = Math.sign(expectedDelta);
    const normalizedDeviationRatio = Number(maxPathDeviationRatio);
    const maxPathDeviation = baselinePrice * (
        Number.isFinite(normalizedDeviationRatio) && normalizedDeviationRatio >= 0
            ? normalizedDeviationRatio
            : INVESTMENT_TRADE_MARKER_GLOW_MAX_PATH_DEVIATION_RATIO
    );
    let maxDeviation = 0;
    for (let offset = 1; offset < path.length; offset += 1) {
        const delta = path[offset] - path[offset - 1];
        const chordValue = fromPrice + (expectedDelta * offset);
        maxDeviation = Math.max(maxDeviation, Math.abs(path[offset] - chordValue));
        if (Math.abs(delta) <= movementTolerance) continue;
        if (direction === 0 || Math.sign(delta) !== direction) return false;
    }
    return maxDeviation <= Math.max(maxPathDeviation, movementTolerance * 3);
}

export function resolveInvestmentTradeMarkerGlowLinks(
    markers,
    {
        maxDistance = INVESTMENT_TRADE_MARKER_GLOW_MAX_DISTANCE_PX,
        maxNeighbors = INVESTMENT_TRADE_MARKER_GLOW_MAX_NEIGHBORS,
        priceValues = null,
        maxPathDeviationRatio = INVESTMENT_TRADE_MARKER_GLOW_MAX_PATH_DEVIATION_RATIO,
        trendToleranceRatio = INVESTMENT_TRADE_MARKER_GLOW_TREND_TOLERANCE_RATIO,
    } = {},
) {
    const normalizedMaxDistance = Number(maxDistance);
    const normalizedMaxNeighbors = Math.max(1, Math.floor(Number(maxNeighbors)) || 1);
    if (!Number.isFinite(normalizedMaxDistance) || normalizedMaxDistance <= 0) return [];
    const points = normalizeInvestmentTradeMarkerGlowPoints(markers);
    const links = [];
    const seenLinks = new Set();
    points.forEach((point) => {
        const candidates = points
            .filter((other) => {
                if (other.index === point.index) return false;
                if (point.type && other.type && point.type !== other.type) return false;
                const distance = Math.hypot(other.x - point.x, other.y - point.y);
                const influenceDistance = normalizedMaxDistance + Math.min(
                    18,
                    (point.radius + other.radius) * 0.9,
                );
                return distance > 0
                    && distance <= influenceDistance
                    && isInvestmentTradeMarkerGlowPathCompatible(
                        point,
                        other,
                        priceValues,
                        {maxPathDeviationRatio, trendToleranceRatio},
                    );
            })
            .map((other) => {
                const distance = Math.hypot(other.x - point.x, other.y - point.y);
                const influenceDistance = normalizedMaxDistance + Math.min(
                    18,
                    (point.radius + other.radius) * 0.9,
                );
                return {
                    other,
                    distance,
                    strength: Math.max(0, Math.min(1, 1 - (distance / influenceDistance))),
                };
            })
            .sort((left, right) => left.distance - right.distance)
            .slice(0, normalizedMaxNeighbors);
        candidates.forEach(({other, distance, strength}) => {
            const linkKey = point.index < other.index
                ? `${point.index}:${other.index}`
                : `${other.index}:${point.index}`;
            if (seenLinks.has(linkKey)) return;
            seenLinks.add(linkKey);
            links.push({
                fromIndex: point.index,
                toIndex: other.index,
                distance,
                strength,
            });
        });
    });
    return links;
}

function resolveInvestmentTradeMarkerGlowZoneBoundary(
    componentPoints,
    componentLinks,
    {
        boundarySamples = INVESTMENT_TRADE_MARKER_GLOW_ZONE_BOUNDARY_SAMPLES,
        edgePadding = INVESTMENT_TRADE_MARKER_GLOW_ZONE_EDGE_PADDING_PX,
    } = {},
) {
    const normalizedBoundarySamples = Math.max(
        12,
        Math.min(48, Math.floor(Number(boundarySamples)) || INVESTMENT_TRADE_MARKER_GLOW_ZONE_BOUNDARY_SAMPLES),
    );
    const normalizedEdgePadding = Number(edgePadding);
    const baseEdgePadding = Number.isFinite(normalizedEdgePadding) && normalizedEdgePadding >= 0
        ? normalizedEdgePadding
        : INVESTMENT_TRADE_MARKER_GLOW_ZONE_EDGE_PADDING_PX;
    const pointByIndex = new Map(componentPoints.map((point) => [point.index, point]));
    const linkStats = new Map(componentPoints.map((point) => [point.index, {
        totalStrength: 0,
        weightedDistance: 0,
        linkCount: 0,
    }]));
    componentLinks.forEach((link) => {
        const from = pointByIndex.get(link.fromIndex);
        const to = pointByIndex.get(link.toIndex);
        if (!from || !to) return;
        const distance = Number(link.distance);
        const strength = Math.max(0, Math.min(1, Number(link.strength) || 0));
        if (!Number.isFinite(distance) || distance <= 0 || strength <= 0) return;
        [
            [from.index, distance],
            [to.index, distance],
        ].forEach(([index, linkedDistance]) => {
            const stats = linkStats.get(index);
            if (!stats) return;
            stats.totalStrength += strength;
            stats.weightedDistance += linkedDistance * strength;
            stats.linkCount += 1;
        });
    });
    const descriptors = componentPoints.map((point) => {
        const stats = linkStats.get(point.index) || {};
        const averageStrength = stats.linkCount > 0
            ? stats.totalStrength / stats.linkCount
            : 0;
        const averageDistance = stats.totalStrength > 0
            ? stats.weightedDistance / stats.totalStrength
            : 0;
        const distancePadding = Math.min(
            8,
            Math.max(0, averageDistance - (point.radius * 1.2)) * 0.08 * averageStrength,
        );
        return {
            point,
            influenceRadius: Math.max(
                3.5,
                (point.radius * 0.55) + baseEdgePadding + distancePadding,
            ),
        };
    });
    const totalWeight = descriptors.reduce(
        (sum, descriptor) => sum + Math.max(1, descriptor.point.radius ** 2),
        0,
    );
    const center = descriptors.reduce((accumulator, descriptor) => {
        const weight = Math.max(1, descriptor.point.radius ** 2);
        accumulator.x += descriptor.point.x * weight;
        accumulator.y += descriptor.point.y * weight;
        return accumulator;
    }, {x: 0, y: 0});
    center.x /= totalWeight;
    center.y /= totalWeight;

    const keyPoints = Array.from({length: normalizedBoundarySamples}, (_, sampleIndex) => {
        const angle = (Math.PI * 2 * sampleIndex) / normalizedBoundarySamples;
        const directionX = Math.cos(angle);
        const directionY = Math.sin(angle);
        const support = descriptors.reduce((maximum, descriptor) => {
            const offsetX = descriptor.point.x - center.x;
            const offsetY = descriptor.point.y - center.y;
            return Math.max(
                maximum,
                (offsetX * directionX) + (offsetY * directionY) + descriptor.influenceRadius,
            );
        }, 0);
        const radius = Math.max(3.5, support);
        return {
            angle,
            radius,
            x: center.x + (directionX * radius),
            y: center.y + (directionY * radius),
        };
    });
    return {center, descriptors, keyPoints};
}

export function resolveInvestmentTradeMarkerGlowZones(
    markers,
    links,
    {
        minStrength = INVESTMENT_TRADE_MARKER_GLOW_ZONE_MIN_STRENGTH,
        boundarySamples = INVESTMENT_TRADE_MARKER_GLOW_ZONE_BOUNDARY_SAMPLES,
        edgePadding = INVESTMENT_TRADE_MARKER_GLOW_ZONE_EDGE_PADDING_PX,
    } = {},
) {
    const points = normalizeInvestmentTradeMarkerGlowPoints(markers);
    if (points.length < 2) return [];
    const pointByIndex = new Map(points.map((point) => [point.index, point]));
    const normalizedMinStrength = Number(minStrength);
    const zoneMinStrength = Number.isFinite(normalizedMinStrength) && normalizedMinStrength >= 0
        ? Math.min(1, normalizedMinStrength)
        : INVESTMENT_TRADE_MARKER_GLOW_ZONE_MIN_STRENGTH;
    const parent = points.map((point) => point.index);
    const findRoot = (index) => {
        let root = index;
        while (parent[root] !== root) root = parent[root];
        while (parent[index] !== index) {
            const next = parent[index];
            parent[index] = root;
            index = next;
        }
        return root;
    };
    const union = (left, right) => {
        const leftRoot = findRoot(left);
        const rightRoot = findRoot(right);
        if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
    };
    const eligibleLinks = (Array.isArray(links) ? links : [])
        .map((link) => ({
            fromIndex: Number(link?.fromIndex),
            toIndex: Number(link?.toIndex),
            distance: Number(link?.distance),
            strength: Math.max(0, Math.min(1, Number(link?.strength) || 0)),
        }))
        .filter((link) => {
            const from = pointByIndex.get(link.fromIndex);
            const to = pointByIndex.get(link.toIndex);
            return Boolean(
                from
                && to
                && from.index !== to.index
                && (!from.type || !to.type || from.type === to.type)
                && link.strength >= zoneMinStrength,
            );
        });
    eligibleLinks.forEach((link) => union(link.fromIndex, link.toIndex));
    const components = new Map();
    points.forEach((point) => {
        const root = findRoot(point.index);
        if (!components.has(root)) components.set(root, []);
        components.get(root).push(point);
    });
    return Array.from(components.values())
        .filter((componentPoints) => componentPoints.length >= 2)
        .map((componentPoints) => {
            const componentIndexes = new Set(componentPoints.map((point) => point.index));
            const componentLinks = eligibleLinks.filter((link) => (
                componentIndexes.has(link.fromIndex) && componentIndexes.has(link.toIndex)
            ));
            const boundary = resolveInvestmentTradeMarkerGlowZoneBoundary(
                componentPoints,
                componentLinks,
                {boundarySamples, edgePadding},
            );
            const strength = componentLinks.length
                ? componentLinks.reduce((sum, link) => sum + link.strength, 0) / componentLinks.length
                : 0;
            return {
                center: boundary.center,
                descriptors: boundary.descriptors,
                gradientRadius: Math.max(
                    3.5,
                    ...boundary.keyPoints.map((point) => Math.hypot(
                        point.x - boundary.center.x,
                        point.y - boundary.center.y,
                    )),
                ),
                keyPoints: boundary.keyPoints,
                links: componentLinks,
                pointIndexes: componentPoints.map((point) => point.index),
                strength,
            };
        })
        .filter((zone) => zone.links.length > 0);
}

function drawInvestmentTradeMarkerGlowZoneBoundary(ctx, keyPoints) {
    if (!ctx || !Array.isArray(keyPoints) || keyPoints.length < 3) return false;
    const midpoint = (left, right) => ({
        x: (left.x + right.x) / 2,
        y: (left.y + right.y) / 2,
    });
    const firstMidpoint = midpoint(keyPoints.at(-1), keyPoints[0]);
    ctx.beginPath();
    ctx.moveTo(firstMidpoint.x, firstMidpoint.y);
    keyPoints.forEach((keyPoint, index) => {
        const nextMidpoint = midpoint(keyPoint, keyPoints[(index + 1) % keyPoints.length]);
        if (typeof ctx.quadraticCurveTo !== 'function') return;
        ctx.quadraticCurveTo(keyPoint.x, keyPoint.y, nextMidpoint.x, nextMidpoint.y);
    });
    if (typeof ctx.closePath === 'function') ctx.closePath();
    return true;
}

function resolveInvestmentTradeMarkerGlowRgb(color) {
    const normalizedColor = String(color || '').trim();
    const hexMatch = normalizedColor.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i);
    if (hexMatch) {
        const rawHex = hexMatch[1];
        const expandedHex = rawHex.length === 3
            ? rawHex.split('').map((char) => `${char}${char}`).join('')
            : rawHex;
        return [
            parseInt(expandedHex.slice(0, 2), 16),
            parseInt(expandedHex.slice(2, 4), 16),
            parseInt(expandedHex.slice(4, 6), 16),
        ];
    }
    const rgbMatch = normalizedColor.match(/^rgba?\(([^)]+)\)$/i);
    if (!rgbMatch) return null;
    const channels = rgbMatch[1]
        .split(',')
        .slice(0, 3)
        .map((value) => Number(value.trim()));
    return channels.length === 3 && channels.every((value) => Number.isFinite(value))
        ? channels.map((value) => Math.min(255, Math.max(0, value)))
        : null;
}

function resolveInvestmentTradeMarkerGlowBoundaryDistance(x, y, keyPoints) {
    if (!Array.isArray(keyPoints) || keyPoints.length < 2) return Number.POSITIVE_INFINITY;
    const normalizedX = Number(x);
    const normalizedY = Number(y);
    if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
        return Number.POSITIVE_INFINITY;
    }
    return keyPoints.reduce((minimum, point, index) => {
        const nextPoint = keyPoints[(index + 1) % keyPoints.length];
        const startX = Number(point?.x);
        const startY = Number(point?.y);
        const endX = Number(nextPoint?.x);
        const endY = Number(nextPoint?.y);
        if (![startX, startY, endX, endY].every(Number.isFinite)) return minimum;
        const segmentX = endX - startX;
        const segmentY = endY - startY;
        const segmentLengthSquared = (segmentX ** 2) + (segmentY ** 2);
        const projection = segmentLengthSquared > 0
            ? Math.min(
                1,
                Math.max(
                    0,
                    (((normalizedX - startX) * segmentX) + ((normalizedY - startY) * segmentY))
                        / segmentLengthSquared,
                ),
            )
            : 0;
        const closestX = startX + (segmentX * projection);
        const closestY = startY + (segmentY * projection);
        return Math.min(
            minimum,
            Math.hypot(normalizedX - closestX, normalizedY - closestY),
        );
    }, Number.POSITIVE_INFINITY);
}

function resolveInvestmentTradeMarkerGlowEdgeFade(distance, fadeWidth) {
    const normalizedDistance = Number(distance);
    const normalizedFadeWidth = Number(fadeWidth);
    if (!Number.isFinite(normalizedDistance) || normalizedDistance < 0) return 0;
    if (!Number.isFinite(normalizedFadeWidth) || normalizedFadeWidth <= 0) return 1;
    const progress = Math.min(1, Math.max(0, normalizedDistance / normalizedFadeWidth));
    return progress * progress * (3 - (2 * progress));
}

function createInvestmentTradeMarkerGlowZoneField(
    zone,
    points,
    maxAmount,
    color,
    {
        resolution = INVESTMENT_TRADE_MARKER_GLOW_ZONE_FIELD_RESOLUTION,
        softeningPx = INVESTMENT_TRADE_MARKER_GLOW_ZONE_FIELD_SOFTENING_PX,
    } = {},
) {
    const keyPoints = Array.isArray(zone?.keyPoints) ? zone.keyPoints : [];
    if (keyPoints.length < 3 || !Array.isArray(points) || !points.length) return null;
    const rgb = resolveInvestmentTradeMarkerGlowRgb(color);
    if (!rgb) return null;
    const normalizedResolution = Number(resolution);
    if (!Number.isFinite(normalizedResolution) || normalizedResolution <= 0) return null;
    const fieldPoints = points.filter((point) => (
        Number.isFinite(Number(point?.x))
        && Number.isFinite(Number(point?.y))
        && resolveInvestmentTradeMarkerGlowPointAmount(point) > 0
    ));
    if (!fieldPoints.length) return null;
    const boundaryAndPointCoordinates = [...keyPoints, ...fieldPoints];
    const left = Math.floor(Math.min(...boundaryAndPointCoordinates.map((point) => Number(point.x))) - 1);
    const top = Math.floor(Math.min(...boundaryAndPointCoordinates.map((point) => Number(point.y))) - 1);
    const right = Math.ceil(Math.max(...boundaryAndPointCoordinates.map((point) => Number(point.x))) + 1);
    const bottom = Math.ceil(Math.max(...boundaryAndPointCoordinates.map((point) => Number(point.y))) + 1);
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);
    const pixelWidth = Math.max(1, Math.ceil(width * normalizedResolution));
    const pixelHeight = Math.max(1, Math.ceil(height * normalizedResolution));
    const globalScope = typeof globalThis === 'undefined' ? {} : globalThis;
    let canvas = null;
    if (typeof globalScope.OffscreenCanvas === 'function') {
        canvas = new globalScope.OffscreenCanvas(pixelWidth, pixelHeight);
    } else if (globalScope.document && typeof globalScope.document.createElement === 'function') {
        canvas = globalScope.document.createElement('canvas');
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
    }
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    const fieldContext = canvas.getContext('2d');
    if (!fieldContext || typeof fieldContext.createImageData !== 'function') return null;
    const imageData = fieldContext.createImageData(pixelWidth, pixelHeight);
    const data = imageData?.data;
    if (!data) return null;
    const normalizedMaxAmount = Math.abs(Number(maxAmount));
    const normalizedSoftening = Number(softeningPx);
    const fadeWidth = Math.max(1.5, normalizedSoftening);
    const zoneStrength = Math.min(1, Math.max(0, Number(zone?.strength) || 0));
    const maximumAlpha = 0.16 + (0.16 * zoneStrength);
    for (let row = 0; row < pixelHeight; row += 1) {
        const worldY = top + ((row + 0.5) / normalizedResolution);
        for (let column = 0; column < pixelWidth; column += 1) {
            const worldX = left + ((column + 0.5) / normalizedResolution);
            const fieldIntensity = resolveInvestmentTradeMarkerGlowZoneFieldIntensity(
                worldX,
                worldY,
                fieldPoints,
                normalizedMaxAmount,
                {softeningPx: normalizedSoftening},
            );
            const edgeFade = resolveInvestmentTradeMarkerGlowEdgeFade(
                resolveInvestmentTradeMarkerGlowBoundaryDistance(worldX, worldY, keyPoints),
                fadeWidth,
            );
            const visualFieldIntensity = Math.min(
                1,
                Math.max(0, fieldIntensity * INVESTMENT_TRADE_MARKER_GLOW_ZONE_FIELD_VISUAL_GAIN),
            );
            const alpha = Math.min(1, Math.max(0, visualFieldIntensity * maximumAlpha * edgeFade));
            const offset = ((row * pixelWidth) + column) * 4;
            data[offset] = rgb[0];
            data[offset + 1] = rgb[1];
            data[offset + 2] = rgb[2];
            data[offset + 3] = Math.round(alpha * 255);
        }
    }
    fieldContext.putImageData(imageData, 0, 0);
    return {canvas, left, top, width, height};
}

function drawInvestmentTradeMarkerGlowZoneField(ctx, zone, field) {
    if (
        !ctx
        || !field
        || typeof ctx.drawImage !== 'function'
        || typeof ctx.clip !== 'function'
        || !drawInvestmentTradeMarkerGlowZoneBoundary(ctx, zone?.keyPoints)
    ) {
        return false;
    }
    ctx.clip();
    ctx.drawImage(field.canvas, field.left, field.top, field.width, field.height);
    return true;
}

export function drawInvestmentTradeMarkerGlow(ctx, {
    markers = [],
    links = [],
    color,
} = {}) {
    const normalizedColor = String(color || '').trim();
    const points = normalizeInvestmentTradeMarkerGlowPoints(markers);
    if (!ctx || !normalizedColor || !points.length) return false;

    const zones = resolveInvestmentTradeMarkerGlowZones(points, links);
    const pointByIndex = new Map(points.map((point) => [point.index, point]));
    const maxAmount = Math.max(
        0,
        ...points
            .map((point) => resolveInvestmentTradeMarkerGlowPointAmount(point))
            .filter((amount) => Number.isFinite(amount) && amount > 0),
    );
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    zones.forEach((zone) => {
        ctx.save();
        const zonePoints = (Array.isArray(zone?.pointIndexes) ? zone.pointIndexes : [])
            .map((index) => pointByIndex.get(index))
            .filter(Boolean);
        const field = createInvestmentTradeMarkerGlowZoneField(
            zone,
            zonePoints,
            maxAmount,
            normalizedColor,
        );
        if (field && drawInvestmentTradeMarkerGlowZoneField(ctx, zone, field)) {
            ctx.restore();
            return;
        }
        ctx.restore();
    });
    points.forEach((point) => {
        const radius = Number(point.radius);
        if (!Number.isFinite(radius) || radius <= 0) return;
        drawInvestmentTradeMarkerCircle(ctx, {
            x: point.x,
            y: point.y,
            radius,
            opaqueColor: resolveInvestmentTradeMarkerColorWithAlpha(normalizedColor, 0.64),
            transparentColor: resolveInvestmentTradeMarkerColorWithAlpha(normalizedColor, 0),
        });
    });
    ctx.restore();
    return true;
}

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

export {
    aggregateInvestmentScopedPositionStates as aggregateInvestmentStockDetailPositionStates,
};

export function drawInvestmentYAxisValueBadge(chartInstance, {
    y,
    value,
    formattedValue,
    formatTickLabel = (tickValue) => String(tickValue ?? ''),
    fillColor = '#0055cc',
    boundsProperty = '',
    boundsAliases = {},
} = {}) {
    const sharedDrawer = globalThis.WORTHWARD_CHART_AXIS?.drawYAxisValueBadge;
    if (typeof sharedDrawer !== 'function') return null;
    return sharedDrawer(chartInstance, {
        y,
        value,
        formattedValue,
        formatTickLabel,
        fillColor,
        boundsProperty,
        boundsAliases,
    });
}

export function createInvestmentStockDetailsUtils({
    INVESTMENT_SURFACE_LAYOUT_SETTLE_MS,
    adjustTradePriceForRenderedSeries,
    applyInvestmentTransactionToState,
    buildInvestmentFxRateTimeline,
    buildInvestmentAxisTickIndexes,
    buildInvestmentIntradayDayBoundaries,
    buildInvestmentIntradayDayFallbackIndex,
    buildRenderedSplitFactorHints,
    buildTickerPriceIndex,
    clearInvestmentHistoryHighlights,
    clearInvestmentStockDetailHighlights,
    clearInvestmentStockDetailsVisibleLayoutTimer,
    compareInvestmentTransactions,
    compareInvestmentTaxLotTransactions = compareInvestmentTransactions,
    constrainTickerDatesToSharedRange,
    convertAmountToBaseCurrency,
    createPositionState,
    formatAmount,
    formatAmountWithCurrency,
    formatEventType,
    formatHoldingsMoney,
    formatHoldingsPosition,
    formatInvestmentFullDateLines,
    formatInvestmentFullDateParts,
    formatMetricLossAmount,
    formatMetricLossAmountWithCurrency,
    formatTransactionCommissionDisplay,
    formatTransactionCurrency,
    formatTransactionDateDisplay,
    formatTransactionDescription,
    getIndexedClosePriceOnOrBefore,
    getInvestmentBaseCurrency,
    getInvestmentBrokerMeta,
    getInvestmentChartPointsCache,
    getInvestmentCanonicalTicker,
    getInvestmentMarketStoreTickerCandidates,
    getInvestmentProcessedTransactionsCache,
    getInvestmentStockDetailsPnlSummary = () => null,
    getInvestmentStockDetailsPanel,
    getInvestmentStockDetailsPriceChartInstance,
    getInvestmentStockDetailsPriceChartRequestSerial,
    getInvestmentStockDetailsRangeLabels,
    getInvestmentLiveSessionDateKey,
    getInvestmentStockDetailsRealtimePulseTarget = () => null,
    getInvestmentTradeSessionType,
    getMoneyMarketTickerSet,
    getNormalizedTransactionType,
    getSelectedInvestmentStockDetailsRange,
    getTickerQuoteCurrency,
    getTransactionAmount,
    getTransactionBrokerCode,
    getTransactionBrokerRealizedPnl,
    getTransactionCommission,
    getTransactionEffectiveUnitPrice,
    getTransactionPrice,
    getTransactionQuantity,
    getTransactionLotScope,
    getTransactionLotScopeKey,
    getTransactionValuationQuantity,
    getSignedMetricClass = () => '',
    incrementInvestmentStockDetailsPriceChartRequestSerial,
    isFlatPosition,
    isInvestmentStockDetailsIntradayRange,
    loadInvestmentStockDetailsIntradayRows,
    normalizeInvestmentLedgerNos,
    normalizeInvestmentStockDetailsRange,
    normalizeInvestmentTicker,
    normalizeInvestmentIntradayMinuteKey,
    normalizeLedgerDate,
    normalizePriceHistoryPayload,
    renderInvestmentBrokerCell,
    resolveInvestmentTheme,
    setActiveStockDetailsHoverPointRecord,
    setInvestmentStockDetailsPriceChartInstance,
    shouldRunInvestmentRealtimeQuotes = () => false,
    shouldTrackHoldingTicker,
    syncInvestmentHoverLinkedViews,
    syncInvestmentStockDetailsDonutFromInteraction,
    syncInvestmentSharePreview,
    waitForInvestmentStableElementBox,
}) {
    function buildInvestmentStockDetailRows(processedTransactions, ticker) {
        const normalizedTicker = getInvestmentCanonicalTicker(ticker);
        if (!normalizedTicker) return [];
        const sourceTransactions = Array.isArray(processedTransactions) ? processedTransactions : [];
        const stockStates = new Map();
        const moneyMarketTickers = getMoneyMarketTickerSet();
        const priceHistoryRows = window.WORTHWARD_INVESTMENT_DATA?.price_history_by_ticker || {};
        const tickerPriceIndex = buildTickerPriceIndex(normalizePriceHistoryPayload(priceHistoryRows));
        const renderedSplitFactorHints = buildRenderedSplitFactorHints(processedTransactions, tickerPriceIndex);
        let lastKnownTickerPrice = null;
        const detailRowsBySourceIndex = new Map();
        sourceTransactions
            .map((txn, sourceIndex) => ({txn, sourceIndex}))
            .filter(({txn}) => getInvestmentCanonicalTicker(txn?.ticker) === normalizedTicker)
            .sort((left, right) => compareInvestmentTaxLotTransactions(
                left.txn,
                right.txn,
                left.sourceIndex,
                right.sourceIndex,
            ))
            .forEach(({txn, sourceIndex}) => {
            const normalizedType = getNormalizedTransactionType(txn);
            const lotScopeKey = getTransactionLotScopeKey(txn, normalizedTicker);
            if (!stockStates.has(lotScopeKey)) {
                stockStates.set(lotScopeKey, createPositionState(normalizedTicker));
            }
            const stockState = stockStates.get(lotScopeKey);
            const valuationQuantity = getTransactionValuationQuantity(txn, tickerPriceIndex, renderedSplitFactorHints);
            const transactionPrice = getTransactionPrice(txn);
            let realizedPnl = null;
            const computedRealizedPnl = applyInvestmentTransactionToState(
                stockState,
                txn,
                normalizedType,
                valuationQuantity,
                getTransactionAmount(txn),
                normalizeLedgerDate(txn?.date),
                {
                    unitPriceOverride: getTransactionEffectiveUnitPrice(txn, valuationQuantity),
                },
            );
            if (normalizedType === 'sell') {
                realizedPnl = getTransactionBrokerRealizedPnl(txn) ?? computedRealizedPnl;
            } else if (['dividend', 'foreign_tax_withholding', 'payment_in_lieu', 'adjustment'].includes(normalizedType)) {
                realizedPnl = computedRealizedPnl;
            }
            if (shouldTrackHoldingTicker(txn) && Number.isFinite(transactionPrice) && transactionPrice > 0) {
                lastKnownTickerPrice = transactionPrice;
            }
            const holdingQuantity = Number(txn?.holdings?.[normalizedTicker]);
            const safeHoldingQuantity = Number.isFinite(holdingQuantity) ? holdingQuantity : 0;
            let rowMarketValue = null;
            if (!isFlatPosition(safeHoldingQuantity)) {
                const valuationDate = normalizeLedgerDate(txn?.date);
                const isMoneyMarketTicker = moneyMarketTickers.has(normalizedTicker);
                let closePrice = getIndexedClosePriceOnOrBefore(tickerPriceIndex[normalizedTicker], valuationDate);
                if (isMoneyMarketTicker) {
                    const sameDaySellPrice = getNormalizedTransactionType(txn) === 'sell' ? transactionPrice : null;
                    const anchoredPrice = txn.money_market_anchors?.[normalizedTicker];
                    closePrice = sameDaySellPrice ?? anchoredPrice ?? closePrice;
                }
                if ((!Number.isFinite(closePrice) || Math.abs(closePrice) < 1e-9) && Number.isFinite(lastKnownTickerPrice) && lastKnownTickerPrice > 0) {
                    closePrice = lastKnownTickerPrice;
                }
                if (Number.isFinite(closePrice)) {
                    rowMarketValue = safeHoldingQuantity * closePrice;
                }
            }
            detailRowsBySourceIndex.set(sourceIndex, {
                ...txn,
                rowMarketValue,
                rowRealizedPnl: Number.isFinite(realizedPnl) ? realizedPnl : null,
            });
        });
        return sourceTransactions
            .map((txn, sourceIndex) => detailRowsBySourceIndex.get(sourceIndex) || null)
            .filter(Boolean)
            .reverse();
    }

    function getInvestmentStockDetailsAutoRangeContext(ticker, detailRows = []) {
        const normalizedTicker = getInvestmentCanonicalTicker(ticker);
        if (!normalizedTicker) {
            return {
                tradeDates: [],
                isOpenPosition: null,
            };
        }
        const orderedRows = [...(Array.isArray(detailRows) ? detailRows : [])].reverse();
        const tradeDates = [];
        let fallbackShares = 0;
        orderedRows.forEach((txn) => {
            if (getInvestmentCanonicalTicker(txn?.ticker) !== normalizedTicker) return;
            const normalizedType = getNormalizedTransactionType(txn);
            const ledgerDate = normalizeLedgerDate(txn?.date);
            if (ledgerDate && ['buy', 'sell'].includes(normalizedType)) {
                tradeDates.push(ledgerDate);
            }
            const quantity = Number(getTransactionQuantity(txn));
            if (!Number.isFinite(quantity) || quantity <= 0) return;
            if (
                normalizedType === 'buy'
                || normalizedType === 'grant'
                || normalizedType === 'dividend_reinvestment'
                || normalizedType === 'transfer_in'
            ) {
                fallbackShares += quantity;
                return;
            }
            if (normalizedType === 'sell' || normalizedType === 'transfer_out') {
                fallbackShares -= quantity;
            }
        });
        const latestHoldingQuantity = Number(
            Array.isArray(detailRows) && detailRows.length
                ? detailRows[0]?.holdings?.[normalizedTicker]
                : Number.NaN,
        );
        return {
            tradeDates: Array.from(new Set(tradeDates)).sort(),
            isOpenPosition: Number.isFinite(latestHoldingQuantity)
                ? !isFlatPosition(latestHoldingQuantity)
                : !isFlatPosition(fallbackShares),
        };
    }

    function getStockDetailRealizedBreakdown(detailRows, authoritativeRealizedAccounts = []) {
        let dividendIncome = 0;
        let paymentInLieuIncome = 0;
        let dividendWithholding = 0;
        let tradingSpreadIncome = 0;
        const brokerBreakdowns = new Map();

        const addBrokerAmount = (txn, field, amount) => {
            const brokerCode = getTransactionBrokerCode(txn);
            if (!brokerBreakdowns.has(brokerCode)) {
                brokerBreakdowns.set(brokerCode, {
                    brokerCode,
                    brokerLabel: getInvestmentBrokerMeta(brokerCode).label,
                    dividendIncome: 0,
                    paymentInLieuIncome: 0,
                    dividendWithholding: 0,
                    tradingSpreadIncome: 0,
                });
            }
            brokerBreakdowns.get(brokerCode)[field] += amount;
        };

        (Array.isArray(detailRows) ? detailRows : []).forEach((txn) => {
            const realizedPnl = Number(txn?.rowRealizedPnl);
            if (!Number.isFinite(realizedPnl)) return;

            const normalizedType = getNormalizedTransactionType(txn);
            if (normalizedType === 'dividend') {
                dividendIncome += realizedPnl;
                addBrokerAmount(txn, 'dividendIncome', realizedPnl);
                return;
            }
            if (normalizedType === 'payment_in_lieu') {
                paymentInLieuIncome += realizedPnl;
                addBrokerAmount(txn, 'paymentInLieuIncome', realizedPnl);
                return;
            }
            if (normalizedType === 'foreign_tax_withholding') {
                dividendWithholding += realizedPnl;
                addBrokerAmount(txn, 'dividendWithholding', realizedPnl);
                return;
            }

            tradingSpreadIncome += realizedPnl;
            addBrokerAmount(txn, 'tradingSpreadIncome', realizedPnl);
        });

        const brokerBreakdown = Array.from(brokerBreakdowns.values())
            .map((entry) => ({
                ...entry,
                realizedPnl: (
                    entry.dividendIncome
                    + entry.paymentInLieuIncome
                    + entry.dividendWithholding
                    + entry.tradingSpreadIncome
                ),
            }))
            .filter((entry) => Math.abs(entry.realizedPnl) > 1e-9)
            .sort((left, right) => left.brokerLabel.localeCompare(right.brokerLabel));

        const hasNonTradingRealizedRows = (Array.isArray(detailRows) ? detailRows : [])
            .some((txn) => [
                'dividend',
                'foreign_tax_withholding',
                'payment_in_lieu',
                'adjustment',
            ].includes(getNormalizedTransactionType(txn)));
        const normalizedBaseCurrency = String(getInvestmentBaseCurrency() || '').trim().toUpperCase();
        const authoritativeBrokerBreakdown = (
            !hasNonTradingRealizedRows
            && Array.isArray(authoritativeRealizedAccounts)
            && authoritativeRealizedAccounts.length > 0
        )
            ? authoritativeRealizedAccounts
                .filter((account) => (
                    account?.status === 'complete'
                    && String(account.currency || '').trim().toUpperCase() === normalizedBaseCurrency
                    && Number.isFinite(Number(account.realizedPnl))
                ))
                .map((account) => ({
                    brokerCode: account.broker,
                    brokerLabel: getInvestmentBrokerMeta(account.broker).label,
                    dividendIncome: 0,
                    paymentInLieuIncome: 0,
                    dividendWithholding: 0,
                    tradingSpreadIncome: Number(account.realizedPnl),
                    realizedPnl: Number(account.realizedPnl),
                }))
            : [];
        if (authoritativeBrokerBreakdown.length === authoritativeRealizedAccounts.length) {
            const authoritativeRealizedPnl = authoritativeBrokerBreakdown.reduce(
                (total, entry) => total + entry.realizedPnl,
                0,
            );
            return {
                dividendIncome: 0,
                paymentInLieuIncome: 0,
                dividendWithholding: 0,
                tradingSpreadIncome: authoritativeRealizedPnl,
                realizedPnl: authoritativeRealizedPnl,
                brokerBreakdown: authoritativeBrokerBreakdown
                    .sort((left, right) => left.brokerLabel.localeCompare(right.brokerLabel)),
            };
        }

        return {
            dividendIncome,
            paymentInLieuIncome,
            dividendWithholding,
            tradingSpreadIncome,
            realizedPnl: dividendIncome + paymentInLieuIncome + dividendWithholding + tradingSpreadIncome,
            brokerBreakdown,
        };
    }

    function buildInvestmentStockDetailBrokerMetrics(detailRows, ticker, lastPrice) {
        const normalizedTicker = getInvestmentCanonicalTicker(ticker);
        const orderedRows = [...(Array.isArray(detailRows) ? detailRows : [])]
            .reverse()
            .sort((left, right) => compareInvestmentTaxLotTransactions(left, right));
        if (!normalizedTicker || !orderedRows.length) return [];
        const priceHistoryRows = window.WORTHWARD_INVESTMENT_DATA?.price_history_by_ticker || {};
        const tickerPriceIndex = buildTickerPriceIndex(normalizePriceHistoryPayload(priceHistoryRows));
        const renderedSplitFactorHints = buildRenderedSplitFactorHints(orderedRows, tickerPriceIndex);
        const baseCurrency = getInvestmentBaseCurrency();
        const quoteCurrency = getTickerQuoteCurrency(normalizedTicker) || baseCurrency;
        const orderedTransactions = [...(Array.isArray(getInvestmentProcessedTransactionsCache()) ? getInvestmentProcessedTransactionsCache() : [])]
            .sort((left, right) => compareInvestmentTransactions(left, right));
        const fxTimeline = buildInvestmentFxRateTimeline(orderedTransactions, baseCurrency);
        const valuationDate = normalizeLedgerDate(
            orderedRows[orderedRows.length - 1]?.date
            || orderedRows[0]?.date
            || '',
        );
        const brokerMetrics = new Map();

        orderedRows.forEach((txn) => {
            const brokerCode = getTransactionBrokerCode(txn);
            const lotScope = getTransactionLotScope(txn, normalizedTicker);
            const lotScopeKey = getTransactionLotScopeKey(txn, normalizedTicker);
            if (!brokerMetrics.has(lotScopeKey)) {
                brokerMetrics.set(lotScopeKey, {
                    brokerCode,
                    accountId: lotScope.accountId,
                    positionState: createPositionState(normalizedTicker),
                    totalCommission: 0,
                    totalTrades: 0,
                    currencyCounts: new Map(),
                });
            }
            const metric = brokerMetrics.get(lotScopeKey);
            const normalizedType = getNormalizedTransactionType(txn);
            const valuationQuantity = getTransactionValuationQuantity(txn, tickerPriceIndex, renderedSplitFactorHints);
            const transactionCurrency = String(formatTransactionCurrency(txn) || '').trim().toUpperCase();
            if (transactionCurrency) {
                metric.currencyCounts.set(
                    transactionCurrency,
                    Number(metric.currencyCounts.get(transactionCurrency) || 0) + 1,
                );
            }
            metric.totalCommission += Math.abs(getTransactionCommission(txn));
            applyInvestmentTransactionToState(
                metric.positionState,
                txn,
                normalizedType,
                valuationQuantity,
                getTransactionAmount(txn),
                normalizeLedgerDate(txn?.date),
                {
                    unitPriceOverride: getTransactionEffectiveUnitPrice(txn, valuationQuantity),
                },
            );
            if (
                normalizedType === 'sell'
                || normalizedType === 'buy'
            ) {
                metric.totalTrades += 1;
            }
        });

        return Array.from(brokerMetrics.values()).map((metric) => {
            const currency = Array.from(metric.currencyCounts.entries())
                .sort((left, right) => right[1] - left[1])[0]?.[0] || quoteCurrency;
            const shares = Number(metric.positionState.shares) || 0;
            const marketValue = !isFlatPosition(shares) && Number.isFinite(lastPrice)
                ? convertAmountToBaseCurrency(
                    shares * lastPrice,
                    quoteCurrency,
                    valuationDate,
                    fxTimeline,
                    baseCurrency,
                )
                : null;
            return {
                brokerCode: metric.brokerCode,
                accountId: metric.accountId,
                brokerLabel: getInvestmentBrokerMeta(metric.brokerCode).label,
                shares,
                positionDisplay: formatHoldingsPosition(shares),
                marketValue,
                marketValueDisplay: marketValue === null ? '-' : formatHoldingsMoney(marketValue),
                totalTrades: metric.totalTrades,
                totalTradesDisplay: new Intl.NumberFormat('en-US', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                }).format(metric.totalTrades),
                totalCommission: metric.totalCommission,
                totalCommissionDisplay: currency
                    ? formatMetricLossAmountWithCurrency(metric.totalCommission, currency)
                    : formatMetricLossAmount(metric.totalCommission),
            };
        }).sort((left, right) => {
            const leftMarketValue = Number(left.marketValue) || 0;
            const rightMarketValue = Number(right.marketValue) || 0;
            return Math.abs(rightMarketValue) - Math.abs(leftMarketValue);
        });
    }

    function destroyInvestmentStockDetailsPriceChart() {
        clearInvestmentStockDetailsVisibleLayoutTimer();
        const chartInstance = getInvestmentStockDetailsPriceChartInstance();
        if (chartInstance) {
            const chartCanvas = chartInstance.canvas;
            if (chartCanvas?._abortController) {
                chartCanvas._abortController.abort();
                chartCanvas._abortController = null;
            }
            if (chartCanvas?._resizeObserver) {
                chartCanvas._resizeObserver.disconnect();
                chartCanvas._resizeObserver = null;
            }
            if (typeof chartCanvas?._windowResizeHandler === 'function') {
                window.removeEventListener('resize', chartCanvas._windowResizeHandler);
                chartCanvas._windowResizeHandler = null;
            }
            if (Number.isInteger(chartCanvas?._layoutSyncRaf) && chartCanvas._layoutSyncRaf > 0) {
                window.cancelAnimationFrame(chartCanvas._layoutSyncRaf);
                chartCanvas._layoutSyncRaf = 0;
            }
            if (Number.isInteger(chartCanvas?._layoutSyncTimer) && chartCanvas._layoutSyncTimer > 0) {
                window.clearTimeout(chartCanvas._layoutSyncTimer);
                chartCanvas._layoutSyncTimer = 0;
            }
            chartCanvas._scheduleLayoutSync = null;
            chartCanvas._syncInvestmentStockDetailsRealtimePulse = null;
            chartCanvas._investmentStockDetailsChart = null;
            chartInstance.destroy();
            setInvestmentStockDetailsPriceChartInstance(null);
        }
        setActiveStockDetailsHoverPointRecord(null);
    }

    async function renderInvestmentStockDetailsPriceChart(ticker, detailRows = []) {
        const investmentStockDetailsPanel = getInvestmentStockDetailsPanel();
        const chartHost = investmentStockDetailsPanel?.querySelector('[data-investment-stock-price-chart]');
        if (!(chartHost instanceof HTMLElement)) {
            destroyInvestmentStockDetailsPriceChart();
            return;
        }

        destroyInvestmentStockDetailsPriceChart();
        const renderRequestId = incrementInvestmentStockDetailsPriceChartRequestSerial();
        const normalizedTicker = getInvestmentCanonicalTicker(ticker);
        if (!normalizedTicker || !window.Chart) {
            chartHost.innerHTML = '<div class="investment-stock-details-price-chart-empty">Price history is unavailable for this ticker.</div>';
            return;
        }

        const pnlSummary = getInvestmentStockDetailsPnlSummary(normalizedTicker) || {};
        const currentSummaryAveragePrice = Number(pnlSummary.averagePrice);
        const hasCurrentSummaryAveragePrice = (
            Number.isFinite(currentSummaryAveragePrice)
            && currentSummaryAveragePrice > 0
        );
        const baseCurrency = getInvestmentBaseCurrency();
        const quoteCurrency = String(
            pnlSummary.quoteCurrency || getTickerQuoteCurrency(normalizedTicker) || baseCurrency,
        ).trim().toUpperCase() || baseCurrency;
        const processedTransactions = getInvestmentProcessedTransactionsCache();
        const orderedTransactions = [...(
            Array.isArray(processedTransactions) ? processedTransactions : []
        )].sort((left, right) => compareInvestmentTransactions(left, right));
        const fxTimeline = buildInvestmentFxRateTimeline(orderedTransactions, baseCurrency);
        const realizedPnlTimeline = buildInvestmentStockDetailsRealizedPnlTimeline(
            pnlSummary.realizedPnlByDate,
            normalizeLedgerDate,
        );
        const fallbackRealizedPnl = Number(pnlSummary.realizedPnl);
        const resolveHistoricalRealizedPnl = (ledgerDate, isLatestPoint = false) => {
            if (pnlSummary.pnlUnavailable === true) return null;
            if (realizedPnlTimeline.length) {
                return resolveInvestmentStockDetailsCumulativeRealizedPnl(realizedPnlTimeline, ledgerDate);
            }
            // A broker-only total cannot be truthfully allocated to earlier points.
            if (!Number.isFinite(fallbackRealizedPnl)) return null;
            if (Math.abs(fallbackRealizedPnl) <= 1e-9 || isLatestPoint) return fallbackRealizedPnl;
            return null;
        };
        const resolveHistoricalUnrealizedPnl = (snapshot, ledgerDate) => {
            if (pnlSummary.pnlUnavailable === true) return null;
            const shares = Number(snapshot?.shares);
            const closePrice = Number(snapshot?.close);
            const averagePrice = Number(snapshot?.averagePrice);
            if (
                !ledgerDate
                || !Number.isFinite(shares)
                || Math.abs(shares) <= 1e-9
                || !Number.isFinite(closePrice)
                || !Number.isFinite(averagePrice)
            ) {
                return null;
            }
            const unrealizedPnlLocal = shares > 0
                ? (closePrice - averagePrice) * shares
                : (averagePrice - closePrice) * Math.abs(shares);
            const unrealizedPnl = convertAmountToBaseCurrency(
                unrealizedPnlLocal,
                quoteCurrency,
                ledgerDate,
                fxTimeline,
                baseCurrency,
            );
            return Number.isFinite(unrealizedPnl) ? unrealizedPnl : null;
        };

        const normalizedRange = normalizeInvestmentStockDetailsRange(getSelectedInvestmentStockDetailsRange());
        const allowRealtimeData = shouldRunInvestmentRealtimeQuotes();
        let intradayRows = [];
        if (isInvestmentStockDetailsIntradayRange(normalizedRange)) {
            chartHost.innerHTML = '<div class="investment-stock-details-price-chart-empty">Loading 1-minute price history...</div>';
            try {
                intradayRows = await loadInvestmentStockDetailsIntradayRows(normalizedTicker, normalizedRange);
            } catch (error) {
                console.warn(error);
                intradayRows = [];
            }
            if (renderRequestId !== getInvestmentStockDetailsPriceChartRequestSerial()) return;
        }

        const priceHistoryByTicker = normalizePriceHistoryPayload(window.WORTHWARD_INVESTMENT_DATA?.price_history_by_ticker || {});
        const tickerPriceIndex = buildTickerPriceIndex(priceHistoryByTicker);
        const tickerPriceMap = getInvestmentMarketStoreTickerCandidates(normalizedTicker).reduce((selectedMap, candidate) => {
            if (selectedMap && Object.keys(selectedMap).length) return selectedMap;
            const candidateMap = priceHistoryByTicker[candidate];
            return candidateMap && typeof candidateMap === 'object' ? candidateMap : selectedMap;
        }, null) || {};
        const tickerLabels = Object.keys(tickerPriceMap).sort();
        const fullLabels = constrainTickerDatesToSharedRange(tickerLabels);
        const useIntradayCandles = Array.isArray(intradayRows) && intradayRows.length > 0;
        const stockDetailsAutoRangeContext = getInvestmentStockDetailsAutoRangeContext(normalizedTicker, detailRows);
        let labels = useIntradayCandles
            ? intradayRows.map((row) => String(row?.date || ''))
            : getInvestmentStockDetailsRangeLabels(fullLabels, normalizedRange, stockDetailsAutoRangeContext);
        let closeValues = useIntradayCandles
            ? labels.map((_, index) => {
                const close = Number(intradayRows[index]?.close);
                return Number.isFinite(close) && close > 0 ? close : null;
            })
            : labels.map((date) => {
                const close = Number(tickerPriceMap[date]);
                return Number.isFinite(close) && close > 0 ? close : null;
            });
        if (!useIntradayCandles) {
            const liveDateKey = typeof getInvestmentLiveSessionDateKey === 'function'
                ? getInvestmentLiveSessionDateKey()
                : '';
            if (liveDateKey && !labels.some((label) => normalizeLedgerDate(label) === liveDateKey)) {
                const lastFiniteClose = [...closeValues].reverse().find((value) => Number.isFinite(value) && value > 0);
                const fallbackClose = Number(
                    tickerPriceMap[liveDateKey]
                    ?? tickerPriceMap[labels[labels.length - 1]]
                    ?? lastFiniteClose
                );
                labels = [...labels, liveDateKey];
                closeValues = [
                    ...closeValues,
                    Number.isFinite(fallbackClose) && fallbackClose > 0 ? fallbackClose : null,
                ];
            }
        }
        const openValues = useIntradayCandles
            ? labels.map((_, index) => {
                const open = Number(intradayRows[index]?.open);
                return Number.isFinite(open) && open > 0 ? open : null;
            })
            : [];
        const highValues = useIntradayCandles
            ? labels.map((_, index) => {
                const high = Number(intradayRows[index]?.high);
                return Number.isFinite(high) && high > 0 ? high : null;
            })
            : [];
        const lowValues = useIntradayCandles
            ? labels.map((_, index) => {
                const low = Number(intradayRows[index]?.low);
                return Number.isFinite(low) && low > 0 ? low : null;
            })
            : [];
        if (
            (!tickerLabels.length && !useIntradayCandles)
            || !closeValues.some((value) => Number.isFinite(value) && value > 0)
        ) {
            chartHost.innerHTML = '<div class="investment-stock-details-price-chart-empty">Price history is unavailable for this ticker.</div>';
            return;
        }
        const latestVisibleLabel = String(labels[labels.length - 1] || '');
        const latestAvailableLabel = String(
            useIntradayCandles
                ? intradayRows[intradayRows.length - 1]?.date || ''
                : fullLabels[fullLabels.length - 1] || ''
        );
        const shouldRenderRealtimePulse = Boolean(
            allowRealtimeData
            && latestVisibleLabel
            && latestAvailableLabel
            && latestVisibleLabel === latestAvailableLabel
            && !(normalizedRange === 'auto' && stockDetailsAutoRangeContext?.isOpenPosition === false)
        );
        const getRealtimePulseTarget = () => {
            if (!shouldRenderRealtimePulse || typeof getInvestmentStockDetailsRealtimePulseTarget !== 'function') {
                return null;
            }
            const target = getInvestmentStockDetailsRealtimePulseTarget(normalizedTicker);
            const price = Number(target?.price);
            return Number.isFinite(price) && price > 0 ? { ...target, price } : null;
        };

        await waitForInvestmentStableElementBox(chartHost, {
            minimumWidth: 160,
            minimumHeight: 180,
        });
        if (renderRequestId !== getInvestmentStockDetailsPriceChartRequestSerial()) return;

        chartHost.innerHTML = `
            <div class="investment-stock-details-price-chart-stage">
                <canvas class="investment-stock-details-price-chart-canvas"></canvas>
                <div class="investment-stock-details-live-marker" data-investment-stock-details-live-marker hidden aria-hidden="true">
                    <span class="investment-stock-details-live-marker-ring investment-stock-details-live-marker-ring-outer"></span>
                    <span class="investment-stock-details-live-marker-ring investment-stock-details-live-marker-ring-inner"></span>
                    <span class="investment-stock-details-live-marker-core"></span>
                </div>
            </div>
        `;
        const canvas = chartHost.querySelector('canvas');
        const realtimeMarkerElement = chartHost.querySelector('[data-investment-stock-details-live-marker]');
        if (!(canvas instanceof HTMLCanvasElement)) return;

        const chronologicalRows = [...(Array.isArray(detailRows) ? detailRows : [])].reverse();
        const renderedSplitFactorHints = buildRenderedSplitFactorHints(chronologicalRows, tickerPriceIndex);
        const dateIndex = new Map();
        labels.forEach((value, index) => {
            dateIndex.set(String(value), index);
            const minuteKey = normalizeInvestmentIntradayMinuteKey(value);
            if (minuteKey) dateIndex.set(minuteKey, index);
        });
        const intradayDayFallbackIndex = buildInvestmentIntradayDayFallbackIndex(labels);
        const intradayDayBoundaries = buildInvestmentIntradayDayBoundaries(labels);
        const getTransactionDatetimeValue = (txn) => String(txn?.datetime || txn?.date || '').trim();
        const getTransactionSessionType = (txn, datetimeValue) => (
            getInvestmentStockDetailsTransactionSessionType(
                txn,
                datetimeValue,
                getInvestmentTradeSessionType,
            )
        );
        const getNextVisibleIntradayDayBoundary = (ledgerDate) => {
            const normalizedLedgerDate = normalizeLedgerDate(ledgerDate);
            if (!normalizedLedgerDate) return null;
            return intradayDayBoundaries.orderedDays.find((dayBoundary) => dayBoundary.dayKey > normalizedLedgerDate) || null;
        };
        const resolveIntradayDayBoundaryForTransaction = (txn, sessionType) => {
            const ledgerDate = normalizeLedgerDate(txn?.date);
            const datetimeMatch = getTransactionDatetimeValue(txn).match(/^\d{4}-\d{2}-\d{2}(?:[T ](\d{2}):(\d{2}))/);
            const hour = datetimeMatch ? Number(datetimeMatch[1]) : null;
            const minute = datetimeMatch ? Number(datetimeMatch[2]) : null;
            const totalMinutes = Number.isInteger(hour) && Number.isInteger(minute)
                ? (hour * 60) + minute
                : null;
            if (sessionType === 'night' && Number.isFinite(totalMinutes) && totalMinutes >= 20 * 60) {
                return getNextVisibleIntradayDayBoundary(ledgerDate);
            }
            return intradayDayBoundaries.dayMap.get(ledgerDate) || null;
        };
        const getTransactionTotalMinutes = (txn) => {
            const transactionDatetimeValue = getTransactionDatetimeValue(txn);
            const datetimeMatch = transactionDatetimeValue.match(/^\d{4}-\d{2}-\d{2}(?:[T ](\d{2}):(\d{2}))/);
            const hour = datetimeMatch ? Number(datetimeMatch[1]) : null;
            const minute = datetimeMatch ? Number(datetimeMatch[2]) : null;
            return Number.isInteger(hour) && Number.isInteger(minute)
                ? (hour * 60) + minute
                : null;
        };
        const resolveTrailingOffHoursDayBoundaryForTransaction = (txn, sessionType) => {
            const lastVisibleDayBoundary = intradayDayBoundaries.orderedDays.at(-1) || null;
            const anchorDayKey = resolveInvestmentStockDetailsTrailingOffHoursAnchorDayKey(
                txn,
                sessionType,
                lastVisibleDayBoundary?.dayKey,
            );
            return anchorDayKey
                ? intradayDayBoundaries.dayMap.get(anchorDayKey) || null
                : null;
        };
        const isTransactionBeforeVisibleRange = (txn) => {
            if (!labels.length) return false;
            const firstVisibleLedgerDate = normalizeLedgerDate(labels[0]);
            const transactionLedgerDate = normalizeLedgerDate(txn?.date);
            if (!firstVisibleLedgerDate || !transactionLedgerDate) return false;
            return transactionLedgerDate < firstVisibleLedgerDate;
        };
        const isTransactionAfterVisibleRange = (txn) => {
            if (!labels.length) return false;
            const lastVisibleLedgerDate = normalizeLedgerDate(labels[labels.length - 1]);
            const transactionLedgerDate = normalizeLedgerDate(txn?.date);
            if (!lastVisibleLedgerDate || !transactionLedgerDate) return false;
            if (transactionLedgerDate > lastVisibleLedgerDate) return true;
            if (transactionLedgerDate < lastVisibleLedgerDate) return false;
            const transactionDatetimeValue = getTransactionDatetimeValue(txn);
            const sessionType = getTransactionSessionType(txn, transactionDatetimeValue);
            const totalMinutes = getTransactionTotalMinutes(txn);
            return sessionType === 'night' && Number.isFinite(totalMinutes) && totalMinutes >= 20 * 60;
        };
        const resolveTradeMarkerPrice = (markerIndex, transactionPrice) => {
            const normalizedTransactionPrice = Number(transactionPrice);
            const normalizedClosePrice = Number(closeValues[markerIndex]);
            if (Number.isFinite(normalizedTransactionPrice) && normalizedTransactionPrice > 0) {
                return adjustTradePriceForRenderedSeries(normalizedTransactionPrice, normalizedClosePrice);
            }
            return Number.isFinite(normalizedClosePrice) && normalizedClosePrice > 0
                ? normalizedClosePrice
                : null;
        };
        const resolveTradeMarkerAmount = (txn, fallbackPrice = null) => {
            const transactionAmount = Number(getTransactionAmount(txn));
            if (Number.isFinite(transactionAmount) && Math.abs(transactionAmount) > 1e-9) {
                return Math.abs(transactionAmount);
            }
            const quantity = Math.abs(Number(getTransactionQuantity(txn)));
            const transactionPrice = Number(getTransactionPrice(txn));
            const price = Math.abs(
                Number.isFinite(transactionPrice) && transactionPrice > 0
                    ? transactionPrice
                    : Number(fallbackPrice),
            );
            if (
                Number.isFinite(quantity)
                && quantity > 0
                && Number.isFinite(price)
                && price > 0
            ) {
                return quantity * price;
            }
            return 0;
        };
        const tradeMarkerPoints = chronologicalRows.reduce((accumulator, txn) => {
            const normalizedType = getNormalizedTransactionType(txn);
            if (!['buy', 'sell'].includes(normalizedType)) return accumulator;
            const transactionDatetimeValue = getTransactionDatetimeValue(txn);
            const transactionSessionType = getTransactionSessionType(txn, transactionDatetimeValue);
            const trailingOffHoursDayBoundary = useIntradayCandles
                ? resolveTrailingOffHoursDayBoundaryForTransaction(txn, transactionSessionType)
                : null;
            if (
                useIntradayCandles
                && (
                    isTransactionBeforeVisibleRange(txn)
                    || (isTransactionAfterVisibleRange(txn) && !trailingOffHoursDayBoundary)
                )
            ) {
                return accumulator;
            }
            const exactMinuteKey = normalizeInvestmentIntradayMinuteKey(transactionDatetimeValue);
            const transactionPrice = getTransactionPrice(txn);
            const ledgerDate = normalizeLedgerDate(txn?.date);
            let markerIndex = null;
            let markerPlacement = 'bar';
            let markerSessionType = 'intraday';
            let markerPrice = null;
            let markerAnchorDayKey = ledgerDate;
            if (useIntradayCandles) {
                markerSessionType = transactionSessionType;
                const exactMinuteIndex = dateIndex.get(exactMinuteKey);
                if (Number.isInteger(exactMinuteIndex)) {
                    markerIndex = exactMinuteIndex;
                    markerPrice = resolveTradeMarkerPrice(exactMinuteIndex, transactionPrice);
                } else if (trailingOffHoursDayBoundary) {
                    markerPlacement = 'trailing-gap';
                    markerIndex = trailingOffHoursDayBoundary.lastIndex;
                    markerPrice = resolveTradeMarkerPrice(markerIndex, transactionPrice);
                } else if (markerSessionType !== 'intraday') {
                    const dayBoundary = resolveIntradayDayBoundaryForTransaction(txn, markerSessionType);
                    if (dayBoundary) {
                        markerPlacement = 'gap';
                        markerAnchorDayKey = dayBoundary.dayKey;
                        markerIndex = markerSessionType === 'post' ? dayBoundary.lastIndex : dayBoundary.firstIndex;
                        markerPrice = resolveTradeMarkerPrice(markerIndex, transactionPrice);
                    }
                }
                if (!Number.isInteger(markerIndex)) {
                    markerIndex = intradayDayFallbackIndex.get(ledgerDate);
                    if (Number.isInteger(markerIndex)) {
                        markerPrice = resolveTradeMarkerPrice(markerIndex, transactionPrice);
                    }
                }
            } else {
                markerIndex = resolveInvestmentStockDetailsDailySnapshotIndex(
                    ledgerDate,
                    labels,
                    normalizeLedgerDate,
                );
                if (Number.isInteger(markerIndex)) {
                    markerPrice = resolveTradeMarkerPrice(markerIndex, transactionPrice);
                }
            }
            if (!Number.isInteger(markerIndex)) return accumulator;
            if (!Number.isFinite(markerPrice)) return accumulator;
            const marker = {
                index: markerIndex,
                x: labels[markerIndex],
                y: markerPrice,
                type: normalizedType,
                amount: resolveTradeMarkerAmount(txn, markerPrice),
                quantity: Math.abs(Number(getTransactionQuantity(txn))),
                placement: markerPlacement,
                sessionType: markerSessionType,
                ledgerDate,
                anchorDayKey: trailingOffHoursDayBoundary?.dayKey || markerAnchorDayKey,
                transactionPrice: Number.isFinite(transactionPrice) ? transactionPrice : null,
            };
            if (normalizedType === 'buy') accumulator.buy.push(marker);
            if (normalizedType === 'sell') accumulator.sell.push(marker);
            return accumulator;
        }, { buy: [], sell: [] });
        const maxTradeMarkerAmount = Math.max(
            0,
            ...[...tradeMarkerPoints.buy, ...tradeMarkerPoints.sell]
                .map((marker) => Number(marker?.amount))
                .filter((amount) => Number.isFinite(amount) && amount > 0),
        );
        const shouldReserveTrailingOffHoursGap = Boolean(
            useIntradayCandles
            && [...tradeMarkerPoints.buy, ...tradeMarkerPoints.sell]
                .some((marker) => marker?.placement === 'trailing-gap'),
        );
        const resolveAveragePriceSnapshotIndex = (txn) => {
            const ledgerDate = normalizeLedgerDate(txn?.date);
            if (!ledgerDate) return null;
            if (useIntradayCandles) {
                if (isTransactionBeforeVisibleRange(txn) || isTransactionAfterVisibleRange(txn)) return null;
                const transactionDatetimeValue = getTransactionDatetimeValue(txn);
                const exactMinuteIndex = dateIndex.get(normalizeInvestmentIntradayMinuteKey(transactionDatetimeValue));
                if (Number.isInteger(exactMinuteIndex)) return exactMinuteIndex;
                const sessionType = getTransactionSessionType(txn, transactionDatetimeValue);
                const dayBoundary = resolveIntradayDayBoundaryForTransaction(txn, sessionType);
                if (dayBoundary) {
                    if (sessionType === 'post') {
                        return dayBoundary.lastIndex;
                    }
                    if (sessionType === 'pre' || sessionType === 'night') {
                        return dayBoundary.firstIndex;
                    }
                }
                const fallbackIndex = intradayDayFallbackIndex.get(ledgerDate);
                return Number.isInteger(fallbackIndex) ? fallbackIndex : null;
            }
            return resolveInvestmentStockDetailsDailySnapshotIndex(
                ledgerDate,
                labels,
                normalizeLedgerDate,
            );
        };
        const preRangeTransactions = [];
        const transactionsBySnapshotIndex = chronologicalRows.reduce((accumulator, txn) => {
            const snapshotIndex = resolveAveragePriceSnapshotIndex(txn);
            if (!Number.isInteger(snapshotIndex)) {
                if (isTransactionBeforeVisibleRange(txn)) {
                    preRangeTransactions.push(txn);
                }
                return accumulator;
            }
            if (!accumulator.has(snapshotIndex)) accumulator.set(snapshotIndex, []);
            accumulator.get(snapshotIndex).push(txn);
            return accumulator;
        }, new Map());
        const stockSnapshotsByDate = new Map();
        const investmentPointByDate = new Map((Array.isArray(getInvestmentChartPointsCache()) ? getInvestmentChartPointsCache() : [])
            .map((point) => [normalizeLedgerDate(point?.date), point])
            .filter(([date]) => Boolean(date)));
        const stockStates = new Map();
        const renderedStockStates = new Map();
        const getStockDetailScopeKey = (txn) => (
            getTransactionLotScopeKey(txn, normalizedTicker)
            || `ticker:${normalizedTicker}`
        );
        const getOrCreateStockState = (states, scopeKey) => {
            if (!states.has(scopeKey)) states.set(scopeKey, createPositionState(normalizedTicker));
            return states.get(scopeKey);
        };
        const averagePriceSeries = [];
        const applyStockDetailsTransactionToStates = (txn, renderIndex = null) => {
            const normalizedType = getNormalizedTransactionType(txn);
            const scopeKey = getStockDetailScopeKey(txn);
            const stockState = getOrCreateStockState(stockStates, scopeKey);
            const renderedStockState = getOrCreateStockState(renderedStockStates, scopeKey);
            const lotScope = getTransactionLotScope(txn, normalizedTicker);
            stockState.lotScope = lotScope;
            renderedStockState.lotScope = lotScope;
            const quantity = Number(getTransactionValuationQuantity(
                txn,
                tickerPriceIndex,
                renderedSplitFactorHints,
            ));
            const effectiveUnitPrice = getTransactionEffectiveUnitPrice(txn, quantity);
            const renderedEffectiveUnitPrice = Number.isInteger(renderIndex)
                ? resolveTradeMarkerPrice(renderIndex, effectiveUnitPrice)
                : effectiveUnitPrice;
            applyInvestmentTransactionToState(
                stockState,
                txn,
                normalizedType,
                quantity,
                getTransactionAmount(txn),
                normalizeLedgerDate(txn?.date),
                {unitPriceOverride: effectiveUnitPrice},
            );
            applyInvestmentTransactionToState(
                renderedStockState,
                txn,
                normalizedType,
                quantity,
                getTransactionAmount(txn),
                normalizeLedgerDate(txn?.date),
                {
                    unitPriceOverride: Number.isFinite(renderedEffectiveUnitPrice)
                        ? renderedEffectiveUnitPrice
                        : effectiveUnitPrice,
                },
            );
            if (normalizedType === 'buy' && Number.isFinite(quantity) && quantity > 0) {
                return { buyQuantity: quantity, sellQuantity: 0 };
            }
            if (normalizedType === 'sell' && Number.isFinite(quantity) && quantity > 0) {
                return { buyQuantity: 0, sellQuantity: quantity };
            }
            return { buyQuantity: 0, sellQuantity: 0 };
        };
        preRangeTransactions.forEach((txn) => {
            applyStockDetailsTransactionToStates(txn);
        });
        labels.forEach((label, index) => {
            const snapshotTxns = transactionsBySnapshotIndex.get(index) || [];
            let buyQuantity = 0;
            let sellQuantity = 0;
            snapshotTxns.forEach((txn) => {
                const deltas = applyStockDetailsTransactionToStates(txn, index);
                buyQuantity += deltas.buyQuantity;
                sellQuantity += deltas.sellQuantity;
            });
            const buySellLedgerNos = snapshotTxns
                .filter((txn) => ['buy', 'sell'].includes(getNormalizedTransactionType(txn)))
                .map((txn) => Number(txn?.ledger_no))
                .filter((ledgerNo) => Number.isFinite(ledgerNo) && ledgerNo > 0)
                .sort((left, right) => right - left);
            const aggregateState = aggregateInvestmentStockDetailPositionStates(
                stockStates,
                normalizedTicker,
                getTickerQuoteCurrency,
            );
            const renderedAggregateState = aggregateInvestmentStockDetailPositionStates(
                renderedStockStates,
                normalizedTicker,
                getTickerQuoteCurrency,
            );
            const close = Number(closeValues[index]);
            const replayAveragePrice = Number(aggregateState.averagePrice);
            const averagePrice = (
                index === labels.length - 1
                && hasCurrentSummaryAveragePrice
            )
                ? currentSummaryAveragePrice
                : replayAveragePrice;
            averagePriceSeries.push(
                Number.isFinite(averagePrice) && averagePrice > 0
                    ? averagePrice
                    : null,
            );
            stockSnapshotsByDate.set(String(label), {
                shares: Number.isFinite(aggregateState.shares) ? aggregateState.shares : 0,
                close: Number.isFinite(close) ? close : null,
                averagePrice: Number.isFinite(averagePrice)
                    ? averagePrice
                    : null,
                buyQuantity,
                sellQuantity,
                buySellLedgerNos,
            });
        });

        const resolvedTheme = resolveInvestmentTheme();
        const applyCanvasAlpha = resolveInvestmentTradeMarkerColorWithAlpha;
        const formatMoney = (value) => new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
        const formatShareCount = (value) => {
            const numericValue = Number(value);
            if (!Number.isFinite(numericValue)) return '--';
            return numericValue.toLocaleString('en-US', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 6,
            });
        };
        const parseRawDate = (value) => {
            if (typeof value !== 'string') return null;
            const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
            if (!match) return null;
            return {
                year: Number(match[1]),
                monthIndex: Number(match[2]) - 1,
                day: Number(match[3]),
                hours: match[4] ? Number(match[4]) : null,
                minutes: match[5] ? Number(match[5]) : null,
            };
        };
        const formatTooltipDate = (dateParts) => {
            return formatInvestmentFullDateParts(dateParts, { includeTime: true });
        };
        const formatAxisDateLines = (dateParts) => {
            return formatInvestmentFullDateLines(dateParts, { allowWrap: true });
        };
        const formatAxisDateOnlyLines = (dateParts) => {
            if (!dateParts) return ['', ''];
            return formatInvestmentFullDateLines({
                year: dateParts.year,
                monthIndex: dateParts.monthIndex,
                day: dateParts.day,
                hours: null,
                minutes: null,
            }, { allowWrap: true });
        };
        const buildIntradayCenteredAxisTicks = () => {
            if (!useIntradayCandles || normalizedRange !== '1w') return [];
            return intradayDayBoundaries.orderedDays
                .map((dayBoundary) => {
                    const firstIndex = Number(dayBoundary?.firstIndex);
                    const lastIndex = Number(dayBoundary?.lastIndex);
                    if (!Number.isInteger(firstIndex) || !Number.isInteger(lastIndex)) return null;
                    const labelIndex = Math.round((firstIndex + lastIndex) / 2);
                    const parsedDate = parseRawDate(labels[firstIndex] || labels[labelIndex]);
                    if (!parsedDate) return null;
                    return {
                        firstIndex,
                        lastIndex,
                        labelIndex,
                        parsedDate,
                    };
                })
                .filter(Boolean);
        };
        const chartAxis = (typeof window !== "undefined" && window.WORTHWARD_CHART_AXIS) || {};
        const buildTickIndexSet = (count, plotWidth) => (
            typeof chartAxis.buildTickIndexSet === "function"
                ? chartAxis.buildTickIndexSet(count, plotWidth)
                : (() => {
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
                })()
        );
        const STOCK_DETAILS_MARKER_X_PADDING_PX = INVESTMENT_TRADE_MARKER_GLOW_SAFE_PADDING_PX;
        const STOCK_DETAILS_MARKER_Y_PADDING_PX = INVESTMENT_TRADE_MARKER_GLOW_SAFE_PADDING_PX;
        const getStockDetailsChartYScaleValues = () => ([
            ...openValues,
            ...highValues,
            ...lowValues,
            ...closeValues,
            ...averagePriceSeries,
            ...tradeMarkerPoints.buy.map((marker) => marker.y),
            ...tradeMarkerPoints.sell.map((marker) => marker.y),
            getRealtimePulseTarget()?.price,
        ]);
        const buildPixelPaddedYScale = (chartCanvas, values, paddingPx) => {
            const finiteValues = (Array.isArray(values) ? values : [])
                .filter((value) => value !== null && value !== undefined && value !== '')
                .map((value) => Number(value))
                .filter((value) => Number.isFinite(value) && value > 0);
            if (!finiteValues.length) return {};
            const rawMin = Math.min(...finiteValues);
            const rawMax = Math.max(...finiteValues);
            if (rawMin === rawMax) {
                const fallbackPadding = Math.abs(rawMin || 1) * 0.02 || 1;
                return {
                    min: rawMin - fallbackPadding,
                    max: rawMax + fallbackPadding,
                };
            }
            const canvasHeight = Math.max(chartCanvas?.clientHeight || 0, 80);
            const usableHeight = Math.max(canvasHeight - (paddingPx * 2), 1);
            const dataPadding = (rawMax - rawMin) * (paddingPx / usableHeight);
            return {
                min: rawMin - dataPadding,
                max: rawMax + dataPadding,
            };
        };
        const getChartAxisTickDecimalPlaces = (value) => {
            const numericValue = Number(value);
            if (!Number.isFinite(numericValue)) return 0;
            const normalizedString = numericValue
                .toFixed(8)
                .replace(/(?:\.0+|(\.\d*?[1-9]))0+$/, '$1');
            const decimalPart = normalizedString.split('.')[1] || '';
            return decimalPart.length;
        };
        const resolveStockDetailsYAxisFractionDigits = (ticks) => {
            const tickItems = Array.isArray(ticks) ? ticks : [];
            const visibleTickItems = tickItems.length > 2 ? tickItems.slice(1, -1) : tickItems;
            const maxFractionDigits = visibleTickItems.reduce((maxDigits, tick) => {
                const tickValue = Number(tick?.value ?? tick);
                return Math.max(maxDigits, getChartAxisTickDecimalPlaces(tickValue));
            }, 0);
            return maxFractionDigits > 0 ? Math.max(1, maxFractionDigits) : 0;
        };
        const formatStockDetailsYAxisTickLabel = (value) => {
            const numericValue = Number(value);
            if (!Number.isFinite(numericValue)) return '';
            if (typeof chartAxis.formatStockPriceAxisValue === 'function') {
                return chartAxis.formatStockPriceAxisValue(numericValue);
            }
            const fractionDigits = Math.abs(numericValue) >= 100 ? 0 : 2;
            return new Intl.NumberFormat('en-US', {
                minimumFractionDigits: fractionDigits,
                maximumFractionDigits: fractionDigits,
            }).format(numericValue);
        };
        const xAxisLabelPlugin = {
            id: 'investmentStockDetailsXAxisLabelPlugin',
            afterDraw(chart) {
                const { ctx, chartArea, scales } = chart;
                const xScale = scales?.x;
                if (!chartArea || !xScale || !labels.length) return;
                const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
                const intradayCenteredTicks = buildIntradayCenteredAxisTicks();
                if (intradayCenteredTicks.length) {
                    const baselineY = chartArea.bottom;
                    const lineHeight = 10;
                    ctx.save();
                    ctx.fillStyle = resolvedTheme.muted;
                    ctx.font = '400 12px "GDS Transport", "Helvetica Neue", Arial, sans-serif';
                    ctx.textBaseline = 'top';
                    ctx.textAlign = 'center';
                    intradayCenteredTicks.forEach((tick) => {
                        const leftX = xScale.getPixelForValue(tick.firstIndex);
                        const rightX = xScale.getPixelForValue(tick.lastIndex);
                        const fallbackX = xScale.getPixelForValue(tick.labelIndex);
                        const x = Number.isFinite(leftX) && Number.isFinite(rightX)
                            ? (leftX + rightX) / 2
                            : fallbackX;
                        if (!Number.isFinite(x)) return;
                        const [firstLine, secondLine] = formatAxisDateOnlyLines(tick.parsedDate);
                        ctx.fillText(firstLine, x, baselineY);
                        ctx.fillText(secondLine, x, baselineY + lineHeight);
                    });
                    ctx.restore();
                    return;
                }
                const tickIndexes = typeof buildInvestmentAxisTickIndexes === 'function'
                    ? buildInvestmentAxisTickIndexes(labels, labels, viewportWidth, parseRawDate)
                    : Array.from(buildTickIndexSet(labels.length, viewportWidth)).sort((left, right) => left - right);
                const baselineY = chartArea.bottom;
                const lineHeight = 10;
                ctx.save();
                ctx.fillStyle = resolvedTheme.muted;
                ctx.font = '400 12px "GDS Transport", "Helvetica Neue", Arial, sans-serif';
                ctx.textBaseline = 'top';
                tickIndexes.forEach((index, tickIndex) => {
                    const parsedDate = parseRawDate(labels[index]);
                    if (!parsedDate) return;
                    const [firstLine, secondLine] = formatAxisDateLines(parsedDate);
                    const x = xScale.getPixelForValue(index);
                    if (!Number.isFinite(x)) return;
                    if (tickIndex === 0) ctx.textAlign = 'left';
                    else if (tickIndex === tickIndexes.length - 1) ctx.textAlign = 'right';
                    else ctx.textAlign = 'center';
                    ctx.fillText(firstLine, x, baselineY);
                    ctx.fillText(secondLine, x, baselineY + lineHeight);
                });
                ctx.restore();
            },
        };
        const candlestickPlugin = {
            id: 'investmentStockDetailsCandlestickPlugin',
            afterDatasetsDraw(chartInstance) {
                if (!useIntradayCandles) return;
                const { ctx, chartArea, scales } = chartInstance;
                const meta = chartInstance.getDatasetMeta(0);
                const xScale = scales?.x;
                const yScale = scales?.y;
                if (!meta || !meta.data.length || !xScale || !yScale || !chartArea) return;
                const columnWidth = (chartArea.right - chartArea.left) / labels.length;
                const candleWidth = Math.min(20, Math.max(1.5, columnWidth * 0.72));
                ctx.save();
                meta.data.forEach((point, index) => {
                    const open = Number(openValues[index]);
                    const high = Number(highValues[index]);
                    const low = Number(lowValues[index]);
                    const close = Number(closeValues[index]);
                    if (![open, high, low, close].every(Number.isFinite)) return;
                    const x = Number(point?.x);
                    if (!Number.isFinite(x)) return;
                    const openY = yScale.getPixelForValue(open);
                    const highY = yScale.getPixelForValue(high);
                    const lowY = yScale.getPixelForValue(low);
                    const closeY = yScale.getPixelForValue(close);
                    ctx.strokeStyle = resolvedTheme.accentPrimary;
                    ctx.fillStyle = resolvedTheme.accentPrimary;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(x, highY);
                    ctx.lineTo(x, lowY);
                    ctx.stroke();
                    const bodyTop = Math.min(openY, closeY);
                    const bodyBottom = Math.max(openY, closeY);
                    const bodyHeight = Math.max(0.75, bodyBottom - bodyTop);
                    ctx.fillRect(x - (candleWidth / 2), bodyTop, candleWidth, bodyHeight);
                });
                ctx.restore();
            },
        };
        const hoverGuidePlugin = {
            id: 'investmentStockDetailsHoverGuidePlugin',
            beforeDatasetsDraw(chartInstance) {
                const { ctx, chartArea } = chartInstance;
                const y = Number(chartInstance?._activeInvestmentStockDetailsGuideY);
                if (!chartArea || !Number.isFinite(y) || y < chartArea.top || y > chartArea.bottom) return;
                const { left, right } = chartArea;
                chartInstance._activeInvestmentStockDetailsGuideBounds = { left, right, y };
                ctx.save();
                ctx.strokeStyle = resolvedTheme.mutedSoft;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(left, y);
                ctx.lineTo(right, y);
                ctx.stroke();
                ctx.restore();
            },
            afterDatasetsDraw(chartInstance) {
                const { ctx, chartArea, scales, tooltip } = chartInstance;
                if (!chartArea || !tooltip || tooltip.opacity === 0) return;
                const x = tooltip.caretX;
                if (!Number.isFinite(x) || x < chartArea.left || x > chartArea.right) return;
                ctx.save();
                ctx.strokeStyle = resolvedTheme.mutedSoft;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, chartArea.top);
                ctx.lineTo(x, chartArea.bottom);
                ctx.stroke();
                ctx.restore();

                const y = Number(chartInstance?._activeInvestmentStockDetailsGuideY);
                const yScale = scales?.y;
                if (!yScale || !Number.isFinite(y) || y < chartArea.top || y > chartArea.bottom) return;
                const price = Number(yScale.getValueForPixel(y));
                if (!Number.isFinite(price)) return;
                const axisFractionDigits = resolveStockDetailsYAxisFractionDigits(yScale.ticks);
                const priceFractionDigits = Math.max(2, axisFractionDigits);
                const formattedPrice = new Intl.NumberFormat('en-US', {
                    minimumFractionDigits: priceFractionDigits,
                    maximumFractionDigits: priceFractionDigits,
                }).format(price);
                drawInvestmentYAxisValueBadge(chartInstance, {
                    y,
                    value: price,
                    formattedValue: formattedPrice,
                    formatTickLabel: formatStockDetailsYAxisTickLabel,
                    fillColor: resolvedTheme.accentPrimary,
                    boundsProperty: '_activeInvestmentStockDetailsGuideBounds',
                    boundsAliases: {formattedPrice, price},
                });
            },
        };
        const resolveTradeMarkerPixelPosition = (chartInstance, marker) => {
            const yScale = chartInstance?.scales?.y;
            const linePoints = chartInstance?.getDatasetMeta(0)?.data || [];
            const chartArea = chartInstance?.chartArea;
            if (!yScale || !linePoints.length || !chartArea) return null;
            const fallbackPoint = linePoints[marker?.index];
            const fallbackX = Number(fallbackPoint?.x);
            const y = Number(yScale.getPixelForValue(marker?.y));
            if (!Number.isFinite(y)) return null;
            if (!['gap', 'trailing-gap'].includes(marker?.placement) || !useIntradayCandles) {
                return Number.isFinite(fallbackX) ? { x: fallbackX, y } : null;
            }
            const dayBoundary = intradayDayBoundaries.dayMap.get(
                marker?.anchorDayKey || marker?.ledgerDate,
            );
            if (!dayBoundary) {
                return Number.isFinite(fallbackX) ? { x: fallbackX, y } : null;
            }
            const previousDay = dayBoundary.ordinal > 0
                ? intradayDayBoundaries.orderedDays[dayBoundary.ordinal - 1]
                : null;
            const nextDay = dayBoundary.ordinal < intradayDayBoundaries.orderedDays.length - 1
                ? intradayDayBoundaries.orderedDays[dayBoundary.ordinal + 1]
                : null;
            const getPointX = (index) => Number(linePoints[index]?.x);
            let leftX = Number.NaN;
            let rightX = Number.NaN;
            let fraction = 0.5;
            if (marker?.placement === 'trailing-gap') {
                leftX = getPointX(dayBoundary.lastIndex);
                rightX = chartArea.right;
                fraction = marker.sessionType === 'night' ? 0.5 : 0.75;
            } else if (marker?.sessionType === 'post') {
                leftX = getPointX(dayBoundary.lastIndex);
                rightX = nextDay ? getPointX(nextDay.firstIndex) : chartArea.right;
                fraction = nextDay ? 0.25 : 0.5;
            } else if (marker?.sessionType === 'night' || marker?.sessionType === 'pre') {
                leftX = previousDay ? getPointX(previousDay.lastIndex) : chartArea.left;
                rightX = getPointX(dayBoundary.firstIndex);
                if (previousDay) {
                    fraction = marker.sessionType === 'night' ? 0.5 : 0.75;
                } else {
                    fraction = marker.sessionType === 'night' ? (1 / 3) : (2 / 3);
                }
            }
            if (!Number.isFinite(leftX) || !Number.isFinite(rightX) || rightX <= leftX) {
                return Number.isFinite(fallbackX) ? { x: fallbackX, y } : null;
            }
            return {
                x: leftX + ((rightX - leftX) * fraction),
                y,
            };
        };
        const tradeMarkerPlugin = {
            id: 'investmentStockDetailsTradeMarkerPlugin',
            afterDatasetsDraw(chartInstance) {
                const drawMarkerGroup = (markers, color) => {
                    const positionedMarkers = [];
                    (Array.isArray(markers) ? markers : []).forEach((marker) => {
                        if (!marker || !Number.isInteger(marker.index) || !Number.isFinite(marker.y)) return;
                        const markerPosition = resolveTradeMarkerPixelPosition(chartInstance, marker);
                        const x = Number(markerPosition?.x);
                        const y = Number(markerPosition?.y);
                        const radius = resolveInvestmentTradeMarkerRadius(
                            marker.amount,
                            maxTradeMarkerAmount,
                        );
                        if (!Number.isFinite(x) || !Number.isFinite(y) || radius <= 0) return;
                        positionedMarkers.push({
                            ...marker,
                            x,
                            y,
                            radius,
                            price: Number(marker.y),
                        });
                    });
                    drawInvestmentTradeMarkerGlow(chartInstance.ctx, {
                        markers: positionedMarkers,
                        links: resolveInvestmentTradeMarkerGlowLinks(positionedMarkers, {
                            priceValues: closeValues,
                        }),
                        color,
                    });
                };
                drawMarkerGroup(tradeMarkerPoints.buy, resolvedTheme.accentPositive);
                drawMarkerGroup(tradeMarkerPoints.sell, resolvedTheme.accentSecondary);
            },
        };
        const realtimeEndMarkerPlugin = {
            id: 'investmentStockDetailsRealtimeEndMarkerPlugin',
            afterDatasetsDraw(chartInstance) {
                if (!shouldRenderRealtimePulse || !(realtimeMarkerElement instanceof HTMLElement)) return;
                const realtimePulseTarget = getRealtimePulseTarget();
                if (!realtimePulseTarget) {
                    realtimeMarkerElement.hidden = true;
                    return;
                }
                const lastIndex = Math.max(0, labels.length - 1);
                const xScale = chartInstance.scales?.x;
                const yScale = chartInstance.scales?.y;
                const chartArea = chartInstance.chartArea;
                if (!xScale || !yScale || !chartArea) {
                    realtimeMarkerElement.hidden = true;
                    return;
                }
                const x = Number(xScale.getPixelForValue(lastIndex));
                const y = Number(yScale.getPixelForValue(realtimePulseTarget.price));
                if (!Number.isFinite(x) || !Number.isFinite(y)) {
                    realtimeMarkerElement.hidden = true;
                    return;
                }
                if (x < chartArea.left || x > chartArea.right || y < chartArea.top || y > chartArea.bottom) {
                    realtimeMarkerElement.hidden = true;
                    return;
                }
                realtimeMarkerElement.style.left = `${x}px`;
                realtimeMarkerElement.style.top = `${y}px`;
                realtimeMarkerElement.hidden = false;
            },
        };
        const getOrCreateTooltip = () => {
            let tooltip = document.querySelector('[data-investment-stock-details-tooltip="1"]');
            if (tooltip) return tooltip;
            tooltip = document.createElement('div');
            tooltip.className = 'chart-tooltip';
            tooltip.dataset.investmentStockDetailsTooltip = '1';
            tooltip.style.position = 'fixed';
            tooltip.innerHTML = '<p class="chart-tooltip-date"></p><div class="chart-tooltip-list"></div>';
            document.body.appendChild(tooltip);
            return tooltip;
        };
        let activeStockDetailsHoverDate = '';
        const externalTooltipHandler = ({ chart, tooltip }) => {
            const tooltipEl = getOrCreateTooltip();
            if (tooltip.opacity === 0) {
                tooltipEl.classList.remove('is-visible');
                activeStockDetailsHoverDate = '';
                setActiveStockDetailsHoverPointRecord(null);
                clearInvestmentStockDetailHighlights();
                clearInvestmentHistoryHighlights();
                syncInvestmentStockDetailsDonutFromInteraction();
                return;
            }
            const pointIndex = tooltip.dataPoints?.[0]?.dataIndex ?? -1;
            const rawDate = labels[pointIndex];
            const parsedDate = parseRawDate(rawDate);
            const snapshot = stockSnapshotsByDate.get(String(rawDate)) || {};
            const buySellLedgerNos = Array.isArray(snapshot?.buySellLedgerNos) ? snapshot.buySellLedgerNos : [];
            const shares = Number(snapshot?.shares);
            const closePrice = Number(snapshot?.close);
            const marketValue = Number.isFinite(shares) && Number.isFinite(closePrice) ? shares * closePrice : null;
            const buyQuantity = Number(snapshot?.buyQuantity);
            const sellQuantity = Number(snapshot?.sellQuantity);
            const hoverLedgerDate = normalizeLedgerDate(rawDate);
            setActiveStockDetailsHoverPointRecord(investmentPointByDate.get(hoverLedgerDate) || null);
            syncInvestmentStockDetailsDonutFromInteraction();
            if (hoverLedgerDate !== activeStockDetailsHoverDate) {
                const primaryLedgerNo = normalizeInvestmentLedgerNos(buySellLedgerNos)[0] || 0;
                if (primaryLedgerNo > 0) {
                    syncInvestmentHoverLinkedViews({
                        hoverLedgerNo: primaryLedgerNo,
                        historyLedgerNos: [primaryLedgerNo],
                        stockDetailLedgerNos: [primaryLedgerNo],
                        interactionLedgerNo: primaryLedgerNo,
                        historyBehavior: 'auto',
                        historyScroll: false,
                        stockDetailBehavior: 'auto',
                        stockDetailScroll: false,
                    });
                } else {
                    clearInvestmentStockDetailHighlights();
                    clearInvestmentHistoryHighlights();
                }
                activeStockDetailsHoverDate = hoverLedgerDate;
            }
            const dateEl = tooltipEl.querySelector('.chart-tooltip-date');
            const listEl = tooltipEl.querySelector('.chart-tooltip-list');
            dateEl.textContent = parsedDate ? formatTooltipDate(parsedDate) : (tooltip.title?.[0] || '');
            const averagePrice = Number(snapshot?.averagePrice);
            const realizedPnl = resolveHistoricalRealizedPnl(
                hoverLedgerDate,
                pointIndex === labels.length - 1,
            );
            const unrealizedPnl = resolveHistoricalUnrealizedPnl(snapshot, hoverLedgerDate);
            const buildPnlRow = (label, value) => {
                const numericValue = Number(value);
                const hasValue = Number.isFinite(numericValue);
                return {
                    label,
                    value: hasValue ? formatHoldingsMoney(numericValue) : '--',
                    color: hasValue
                        ? (numericValue >= 0 ? resolvedTheme.accentPositive : resolvedTheme.accentSecondary)
                        : resolvedTheme.muted,
                    valueClass: hasValue ? getSignedMetricClass(numericValue) : '',
                    bulletHtml: '<span class="chart-tooltip-dot" aria-hidden="true"></span>',
                };
            };
            const tooltipRows = [
                {
                    label: 'Position',
                    value: formatShareCount(shares),
                    color: resolvedTheme.accentPrimary,
                    bulletHtml: '<span class="chart-tooltip-dot" aria-hidden="true"></span>',
                },
                {
                    label: 'Market value',
                    value: Number.isFinite(marketValue) ? formatMoney(marketValue) : '--',
                    color: resolvedTheme.accentSecondary,
                    bulletHtml: '<span class="chart-tooltip-dot" aria-hidden="true"></span>',
                },
                {
                    label: getInvestmentStockDetailsAveragePriceLabel(),
                    value: Number.isFinite(averagePrice) ? formatMoney(averagePrice) : '--',
                    color: resolvedTheme.muted,
                    bulletHtml: '<span class="chart-tooltip-dot" aria-hidden="true"></span>',
                },
                buildPnlRow('Unrealized P&L', unrealizedPnl),
                buildPnlRow('Realized P&L', realizedPnl),
            ];
            if (Number.isFinite(buyQuantity) && buyQuantity > 0) {
                tooltipRows.push({
                    label: 'Buy shares',
                    value: formatShareCount(buyQuantity),
                    color: resolvedTheme.accentPositive,
                    bulletHtml: '<span class="chart-tooltip-dot" aria-hidden="true"></span>',
                });
            }
            if (Number.isFinite(sellQuantity) && sellQuantity > 0) {
                tooltipRows.push({
                    label: 'Sell shares',
                    value: formatShareCount(sellQuantity),
                    color: resolvedTheme.accentSecondary,
                    bulletHtml: '<span class="chart-tooltip-dot" aria-hidden="true"></span>',
                });
            }
            listEl.innerHTML = tooltipRows.map((row) => `
                <div class="chart-tooltip-row">
                    ${row.bulletHtml.replace('class="chart-tooltip-dot"', `class="chart-tooltip-dot" style="background:${row.color}"`)}
                    <span aria-hidden="true"></span>
                    <span class="chart-tooltip-label">${row.label}</span>
                    <span class="chart-tooltip-value${row.valueClass ? ` ${row.valueClass}` : ''}">${row.value}</span>
                </div>
            `).join('');
            const canvasRect = chart.canvas.getBoundingClientRect();
            const tooltipRect = tooltipEl.getBoundingClientRect();
            const padding = 12;
            const gap = 14;
            const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 0;
            const viewportHeight = document.documentElement.clientHeight || window.innerHeight || 0;
            const anchorX = canvasRect.left + tooltip.caretX;
            const anchorY = canvasRect.top + tooltip.caretY;
            const donutCard = investmentStockDetailsPanel?.querySelector('.investment-stock-details-donut-card');
            const donutRect = donutCard instanceof HTMLElement ? donutCard.getBoundingClientRect() : null;
            const rightBoundary = donutRect && donutRect.left > padding
                ? Math.min(viewportWidth - padding, donutRect.left - gap)
                : viewportWidth - padding;
            const roomRight = rightBoundary - anchorX;
            const roomLeft = anchorX - padding;
            const preferRight = roomRight >= tooltipRect.width + gap || roomRight >= roomLeft;
            let left = preferRight ? anchorX + gap : anchorX - tooltipRect.width - gap;
            if (left < padding) left = padding;
            const maxLeft = rightBoundary - tooltipRect.width;
            if (left > maxLeft) left = maxLeft;
            if (left < padding) left = padding;
            let top = anchorY - (tooltipRect.height / 2);
            if (top < padding) top = padding;
            if (top + tooltipRect.height > viewportHeight - padding) {
                top = viewportHeight - tooltipRect.height - padding;
            }
            tooltipEl.style.left = `${left}px`;
            tooltipEl.style.top = `${top}px`;
            tooltipEl.classList.add('is-visible');
        };

        let didNotifyChartReady = false;
        const notifyChartReady = () => {
            if (didNotifyChartReady) return;
            didNotifyChartReady = true;
            if (typeof syncInvestmentSharePreview === 'function') {
                syncInvestmentSharePreview();
            }
        };

        const chartInstance = new window.Chart(canvas, {
            type: 'line',
            data: {
                labels,
                rawLabels: labels,
                datasets: [
                    {
                        label: `${normalizedTicker} close`,
                        data: closeValues,
                        order: 0,
                        borderColor: useIntradayCandles ? 'transparent' : resolvedTheme.accentPrimary,
                        borderWidth: useIntradayCandles ? 0 : 1.5,
                        pointRadius: 0,
                        tension: 0,
                        borderJoinStyle: 'round',
                        borderCapStyle: 'round',
                    },
                    {
                        label: `${normalizedTicker} ${getInvestmentStockDetailsAveragePriceLabel()}`,
                        data: averagePriceSeries,
                        order: 1,
                        borderColor: applyCanvasAlpha(resolvedTheme.muted, useIntradayCandles ? 0.78 : 0.5),
                        backgroundColor: applyCanvasAlpha(resolvedTheme.muted, useIntradayCandles ? 0.78 : 0.5),
                        borderWidth: useIntradayCandles ? 1.35 : 1.0,
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        pointBackgroundColor: applyCanvasAlpha(resolvedTheme.muted, 0.9),
                        pointBorderColor: applyCanvasAlpha(resolvedTheme.muted, 0.9),
                        stepped: useIntradayCandles ? 'before' : false,
                        tension: 0,
                        borderJoinStyle: 'round',
                        borderCapStyle: 'round',
                        spanGaps: false,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: {
                        left: STOCK_DETAILS_MARKER_X_PADDING_PX,
                        right: shouldRenderRealtimePulse || shouldReserveTrailingOffHoursGap
                            ? 32
                            : STOCK_DETAILS_MARKER_X_PADDING_PX,
                        top: shouldRenderRealtimePulse ? 32 : STOCK_DETAILS_MARKER_Y_PADDING_PX,
                        bottom: 24,
                    },
                },
                interaction: { mode: 'index', intersect: false },
                animation: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false, external: externalTooltipHandler },
                },
                scales: {
                    x: {
                        grid: { display: false },
                        border: { display: false },
                        ticks: { display: false },
                    },
                    y: {
                        ...buildPixelPaddedYScale(
                            canvas,
                            getStockDetailsChartYScaleValues(),
                            STOCK_DETAILS_MARKER_Y_PADDING_PX,
                        ),
                        bounds: 'ticks',
                        grid: { display: false, drawTicks: false },
                        border: { display: false },
                        ticks: {
                            color: resolvedTheme.muted,
                            display: true,
                            padding: 0,
                            callback(value, index, ticks) {
                                if (index === 0 || index === ticks.length - 1) return '';
                                return formatStockDetailsYAxisTickLabel(value, ticks);
                            },
                        },
                    },
                },
            },
            plugins: [candlestickPlugin, hoverGuidePlugin, xAxisLabelPlugin, tradeMarkerPlugin, realtimeEndMarkerPlugin],
        });
        setInvestmentStockDetailsPriceChartInstance(chartInstance);
        canvas._syncInvestmentStockDetailsRealtimePulse = () => {
            const yScale = chartInstance.options?.scales?.y;
            if (!yScale) return;
            const nextYScale = buildPixelPaddedYScale(
                canvas,
                getStockDetailsChartYScaleValues(),
                STOCK_DETAILS_MARKER_Y_PADDING_PX,
            );
            yScale.min = nextYScale.min;
            yScale.max = nextYScale.max;
            chartInstance.update('none');
        };
        const readyScheduler = window.WorthwardMotion?.scheduler;
        if (readyScheduler?.frame) {
            let readyFrameCount = 0;
            readyScheduler.frame(`investment-stock-details-chart-ready-${renderRequestId}`, () => {
                readyFrameCount += 1;
                if (readyFrameCount < 2) return true;
                notifyChartReady();
                return false;
            });
        } else {
            window.requestAnimationFrame(() => window.requestAnimationFrame(notifyChartReady));
        }
        const TRADE_MARKER_SNAP_HORIZONTAL_BARS = 3;
        const TRADE_MARKER_SNAP_HORIZONTAL_PX = 20;
        const TRADE_MARKER_SNAP_VERTICAL_PX = 20;
        const resolveNearestHoverState = (chart, event) => {
            const chartArea = chart?.chartArea;
            if (!chartArea || !labels.length) return null;
            const canvasRect = chart.canvas.getBoundingClientRect();
            const relativeX = event.clientX - canvasRect.left;
            const relativeY = event.clientY - canvasRect.top;
            if (!Number.isFinite(relativeX)) return null;
            const points = chart.getDatasetMeta(0)?.data || [];
            let nearestIndex = null;
            let nearestDistance = Number.POSITIVE_INFINITY;
            points.forEach((point, index) => {
                if (!point || !Number.isFinite(point.x)) return;
                const distance = Math.abs(point.x - relativeX);
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestIndex = index;
                }
            });
            if (!Number.isInteger(nearestIndex)) return null;
            if (!Number.isFinite(relativeY)) return { index: nearestIndex, markerType: '' };
            if (relativeY < chartArea.top || relativeY >= chartArea.bottom) return { index: nearestIndex, markerType: '' };
            const guideY = relativeY;
            const markerCandidates = [...tradeMarkerPoints.buy, ...tradeMarkerPoints.sell];
            let snappedMarker = null;
            let snappedMarkerDistance = Number.POSITIVE_INFINITY;
            markerCandidates.forEach((marker) => {
                if (!marker || !Number.isInteger(marker.index) || !Number.isFinite(marker.y)) return;
                if (Math.abs(marker.index - nearestIndex) > TRADE_MARKER_SNAP_HORIZONTAL_BARS) return;
                const markerPosition = resolveTradeMarkerPixelPosition(chart, marker);
                const markerX = Number(markerPosition?.x);
                const markerY = Number(markerPosition?.y);
                if (!Number.isFinite(markerX) || !Number.isFinite(markerY)) return;
                if (Math.abs(markerY - relativeY) >= TRADE_MARKER_SNAP_VERTICAL_PX) return;
                const markerDistance = Math.abs(markerX - relativeX);
                if (markerDistance >= TRADE_MARKER_SNAP_HORIZONTAL_PX) return;
                if (markerDistance < snappedMarkerDistance) {
                    snappedMarkerDistance = markerDistance;
                    snappedMarker = {
                        ...marker,
                        pixelX: markerX,
                        pixelY: markerY,
                    };
                }
            });
            if (snappedMarker && Number.isInteger(snappedMarker.index)) {
                return {
                    index: snappedMarker.index,
                    markerType: String(snappedMarker.type || ''),
                    guideY,
                    markerPosition: {
                        x: snappedMarker.pixelX,
                        y: snappedMarker.pixelY,
                    },
                };
            }
            return { index: nearestIndex, markerType: '', guideY };
        };
        const syncStockDetailsHoverState = (chart, hoverState) => {
            const index = hoverState && Number.isInteger(hoverState.index) ? hoverState.index : null;
            const guideY = Number(hoverState?.guideY);
            chart._activeInvestmentStockDetailsGuideY = Number.isFinite(guideY) ? guideY : null;
            if (!Number.isFinite(guideY)) chart._activeInvestmentStockDetailsGuideBounds = null;
            chart._activeInvestmentStockDetailsMarkerType = index === null
                ? ''
                : String(hoverState?.markerType || '');
            const activeElements = index === null ? [] : [{ datasetIndex: 0, index }];
            chart.setActiveElements(activeElements);
            if (typeof chart.tooltip?.setActiveElements === 'function') {
                if (index === null) {
                    chart.tooltip.setActiveElements([], { x: 0, y: 0 });
                } else {
                    const point = chart.getDatasetMeta(0)?.data?.[index];
                    const fallbackX = Number(chart.chartArea?.left) || 0;
                    const fallbackY = Number(chart.chartArea?.top) || 0;
                    const markerX = Number(hoverState?.markerPosition?.x);
                    const markerY = Number(hoverState?.markerPosition?.y);
                    chart.tooltip.setActiveElements(
                        activeElements,
                        {
                            x: markerX || Number(point?.x) || fallbackX,
                            y: markerY || Number(point?.y) || fallbackY,
                        },
                    );
                }
            }
            chart.update('none');
        };
        const attachStockDetailsHover = (chart) => {
            const chartCanvas = chart?.canvas;
            if (!chartCanvas) return;
            chartCanvas._investmentStockDetailsChart = chart;
            if (chartCanvas._abortController) chartCanvas._abortController.abort();
            const controller = new AbortController();
            chartCanvas._abortController = controller;
            const { signal } = controller;
            chartCanvas.addEventListener('mousemove', (event) => {
                const hoverState = resolveNearestHoverState(chart, event);
                syncStockDetailsHoverState(chart, hoverState);
            }, { signal });
            chartCanvas.addEventListener('mouseleave', () => {
                syncStockDetailsHoverState(chart, null);
            }, { signal });
        };
        attachStockDetailsHover(chartInstance);
        const attachStockDetailsResizeSync = (chart) => {
            const chartCanvas = chart?.canvas;
            if (!chartCanvas) return;
            const applyLayoutSync = () => {
                chartCanvas._layoutSyncRaf = 0;
                const nextYScale = buildPixelPaddedYScale(
                    chartCanvas,
                    getStockDetailsChartYScaleValues(),
                    STOCK_DETAILS_MARKER_Y_PADDING_PX,
                );
                if (Number.isFinite(nextYScale?.min) && Number.isFinite(nextYScale?.max)) {
                    chart.options.scales.y.min = nextYScale.min;
                    chart.options.scales.y.max = nextYScale.max;
                }
                chart.resize();
                chart.update('none');
            };
            const scheduleLayoutSync = () => {
                if (Number.isInteger(chartCanvas._layoutSyncRaf) && chartCanvas._layoutSyncRaf > 0) return;
                chartCanvas._layoutSyncRaf = window.requestAnimationFrame(applyLayoutSync);
            };
            const scheduleSettledLayoutSync = () => {
                if (Number.isInteger(chartCanvas._layoutSyncTimer) && chartCanvas._layoutSyncTimer > 0) {
                    window.clearTimeout(chartCanvas._layoutSyncTimer);
                }
                chartCanvas._layoutSyncTimer = window.setTimeout(() => {
                    chartCanvas._layoutSyncTimer = 0;
                    scheduleLayoutSync();
                }, Math.max(260, INVESTMENT_SURFACE_LAYOUT_SETTLE_MS + 40));
            };
            chartCanvas._scheduleLayoutSync = () => {
                scheduleLayoutSync();
                scheduleSettledLayoutSync();
            };
            if (window.ResizeObserver && chartHost instanceof HTMLElement) {
                const resizeObserver = new ResizeObserver(() => {
                    chartCanvas._scheduleLayoutSync?.();
                });
                resizeObserver.observe(chartHost);
                resizeObserver.observe(chartCanvas);
                if (investmentStockDetailsPanel instanceof HTMLElement) {
                    resizeObserver.observe(investmentStockDetailsPanel);
                }
                chartCanvas._resizeObserver = resizeObserver;
            } else {
                const windowResizeHandler = () => {
                    chartCanvas._scheduleLayoutSync?.();
                };
                window.addEventListener('resize', windowResizeHandler);
                chartCanvas._windowResizeHandler = windowResizeHandler;
            }
            chartCanvas._scheduleLayoutSync?.();
        };
        attachStockDetailsResizeSync(chartInstance);
    }

    return {
        buildInvestmentStockDetailBrokerMetrics,
        buildInvestmentStockDetailRows,
        destroyInvestmentStockDetailsPriceChart,
        getStockDetailRealizedBreakdown,
        renderInvestmentStockDetailsPriceChart,
    };
}
