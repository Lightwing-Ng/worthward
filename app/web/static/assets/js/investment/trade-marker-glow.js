/* Code version: v1.0.2 */
/** Pure geometry and Canvas rendering for Investment trade-marker Glow zones. */

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

export function resolveInvestmentTradeMarkerColorWithAlpha(color, alpha) {
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
    links = null,
    priceValues = null,
    color,
    cache = null,
} = {}) {
    const normalizedColor = String(color || '').trim();
    const points = normalizeInvestmentTradeMarkerGlowPoints(markers);
    if (!ctx || !normalizedColor || !points.length) return false;

    const normalizedLinks = Array.isArray(links) ? links : null;
    const pointSignature = points.map((point) => [
        point.x,
        point.y,
        point.radius,
        point.amount,
        point.type,
        Number(point?.marker?.index),
        Number(point?.marker?.price),
    ].join(':')).join('|');
    const linkSignature = normalizedLinks
        ? normalizedLinks.map((link) => [
            Number(link?.fromIndex),
            Number(link?.toIndex),
            Number(link?.distance),
            Number(link?.strength),
        ].join(':')).join('|')
        : 'auto';
    const reusableCache = cache && typeof cache === 'object' ? cache : null;
    const canReusePlan = Boolean(
        reusableCache?.plan
        && reusableCache.pointSignature === pointSignature
        && reusableCache.linkSignature === linkSignature
        && reusableCache.color === normalizedColor
        && (normalizedLinks || reusableCache.priceValues === priceValues)
    );
    let plan = canReusePlan ? reusableCache.plan : null;
    if (!plan) {
        const resolvedLinks = normalizedLinks || resolveInvestmentTradeMarkerGlowLinks(markers, {
            priceValues,
        });
        const zones = resolveInvestmentTradeMarkerGlowZones(points, resolvedLinks);
        const pointByIndex = new Map(points.map((point) => [point.index, point]));
        const maxAmount = Math.max(
            0,
            ...points
                .map((point) => resolveInvestmentTradeMarkerGlowPointAmount(point))
                .filter((amount) => Number.isFinite(amount) && amount > 0),
        );
        plan = {
            zones: zones.map((zone) => {
                const zonePoints = (Array.isArray(zone?.pointIndexes) ? zone.pointIndexes : [])
                    .map((index) => pointByIndex.get(index))
                    .filter(Boolean);
                return {
                    zone,
                    field: createInvestmentTradeMarkerGlowZoneField(
                        zone,
                        zonePoints,
                        maxAmount,
                        normalizedColor,
                    ),
                };
            }),
        };
        if (reusableCache) {
            reusableCache.pointSignature = pointSignature;
            reusableCache.linkSignature = linkSignature;
            reusableCache.color = normalizedColor;
            reusableCache.priceValues = priceValues;
            reusableCache.plan = plan;
        }
    }
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    plan.zones.forEach(({zone, field}) => {
        ctx.save();
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
