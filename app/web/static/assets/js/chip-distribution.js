/* Code version: v0.4.0 */
(() => {
	const DEFAULT_BIN_COUNT = 100;
	const MIN_BIN_COUNT = 80;
	const MAX_BIN_COUNT = 150;
	const MIN_SIGMA_BINS = 0.75;

	const finiteNumber = (value) => {
		if (value === null || value === undefined || value === "") return null;
		const numeric = Number(value);
		return Number.isFinite(numeric) ? numeric : null;
	};

	const clampBinCount = (value) => {
		const numeric = Number.parseInt(value, 10);
		if (!Number.isFinite(numeric)) return DEFAULT_BIN_COUNT;
		return Math.max(MIN_BIN_COUNT, Math.min(MAX_BIN_COUNT, numeric));
	};

	const normalizeCategoryWeights = (categoryWeights, weights, binCount) => {
		const categories = ["buy", "neutral", "sell"].reduce((result, category) => {
			const source = Array.isArray(categoryWeights?.[category])
				? categoryWeights[category]
				: [];
			result[category] = Array.from({length: binCount}, (_, index) => {
				const value = finiteNumber(source[index]);
				return value === null ? 0 : Math.max(0, value);
			});
			return result;
		}, {});
		const hasCategoryWeight = Object.values(categories).some((values) => values.some((value) => value > 0));
		if (!hasCategoryWeight) {
			categories.neutral = weights.map((weight) => Math.max(0, weight));
		}
		return categories;
	};

	const createDistribution = ({
		minPrice,
		maxPrice,
		binCount,
		weights,
		categoryWeights,
		source,
		estimated,
		metadata = {},
	}) => {
		const resolvedMaxPrice = maxPrice > minPrice
			? maxPrice
			: minPrice + Math.max(Math.abs(minPrice) * 1e-6, 1e-6);
		const priceSpan = resolvedMaxPrice - minPrice;
		const binSize = priceSpan / binCount;
		const categories = normalizeCategoryWeights(categoryWeights, weights, binCount);
		const resolvedWeights = Array.from({length: binCount}, (_, index) => (
			categories.buy[index] + categories.neutral[index] + categories.sell[index]
		));
		const maxWeight = Math.max(...resolvedWeights, 0);
		const totalWeight = resolvedWeights.reduce((total, weight) => total + weight, 0);
		const bins = resolvedWeights.map((weight, index) => {
			const low = minPrice + (index * binSize);
			const high = index === binCount - 1 ? resolvedMaxPrice : low + binSize;
			const buyWeight = categories.buy[index];
			const neutralWeight = categories.neutral[index];
			const sellWeight = categories.sell[index];
			return {
				index,
				low,
				high,
				price: (low + high) / 2,
				weight,
				buyWeight,
				neutralWeight,
				sellWeight,
				normalizedWidth: maxWeight > 0 ? weight / maxWeight : 0,
				normalizedBuyWidth: maxWeight > 0 ? buyWeight / maxWeight : 0,
				normalizedNeutralWidth: maxWeight > 0 ? neutralWeight / maxWeight : 0,
				normalizedSellWidth: maxWeight > 0 ? sellWeight / maxWeight : 0,
			};
		});
		const pocBin = bins.reduce(
			(best, bin) => !best || bin.weight > best.weight ? bin : best,
			null,
		);
		return {
			...metadata,
			source,
			estimated,
			binCount,
			minPrice,
			maxPrice: resolvedMaxPrice,
			binSize,
			totalWeight,
			maxWeight,
			categoryTotals: {
				buy: categories.buy.reduce((total, weight) => total + weight, 0),
				neutral: categories.neutral.reduce((total, weight) => total + weight, 0),
				sell: categories.sell.reduce((total, weight) => total + weight, 0),
			},
			pocPrice: pocBin?.price ?? null,
			pocIndex: pocBin?.index ?? -1,
			bins,
		};
	};

	const normalizeTurnoverRate = (value, unit = "ratio") => {
		const numeric = finiteNumber(value);
		if (numeric === null || numeric < 0) return null;
		const ratio = String(unit).toLowerCase() === "percent" ? numeric / 100 : numeric;
		return Math.max(0, Math.min(1, ratio));
	};

	const normalizeOhlcvRows = (rows, {
		circulatingShares = null,
		floatShares = null,
		turnoverRateUnit = "ratio",
	} = {}) => {
		const defaultShares = finiteNumber(circulatingShares ?? floatShares);
		return (Array.isArray(rows) ? rows : [])
			.map((row) => {
				const volume = finiteNumber(row?.v ?? row?.volume);
				const rowShares = finiteNumber(
					row?.circulatingShares
					?? row?.circulating_shares
					?? defaultShares,
				);
				const explicitTurnoverRate = row?.turnoverRate ?? row?.turnover_rate;
				const turnoverRate = explicitTurnoverRate !== undefined
					? normalizeTurnoverRate(explicitTurnoverRate, turnoverRateUnit)
					: rowShares !== null && rowShares > 0 && volume !== null
						? normalizeTurnoverRate(volume / rowShares)
						: null;
				return {
					timestamp: row?.t ?? row?.timestamp ?? row?.date ?? null,
					open: finiteNumber(row?.o ?? row?.open),
					high: finiteNumber(row?.h ?? row?.high),
					low: finiteNumber(row?.l ?? row?.low),
					close: finiteNumber(row?.c ?? row?.close),
					volume,
					turnoverRate,
					synthetic: row?.synthetic === true,
				};
			})
		.filter((row) => (
			!row.synthetic
			&& [row.open, row.high, row.low, row.close, row.volume].every((value) => value !== null)
			&& row.volume > 0
			&& row.low > 0
			&& row.high >= row.low
		));
	};

	const calculateChipDistribution = (rows, {
		binCount = DEFAULT_BIN_COUNT,
		circulatingShares = null,
		floatShares = null,
		turnoverRateUnit = "ratio",
		shareBasis = "",
		priceMin = null,
		priceMax = null,
	} = {}) => {
		const candles = normalizeOhlcvRows(rows, {
			circulatingShares,
			floatShares,
			turnoverRateUnit,
		});
		if (!candles.length) return null;
		const resolvedBinCount = clampBinCount(binCount);
		const observedMinPrice = Math.min(...candles.map((row) => row.low));
		const observedMaxPrice = Math.max(...candles.map((row) => row.high));
		const requestedMinPrice = finiteNumber(priceMin);
		const requestedMaxPrice = finiteNumber(priceMax);
		const usesFixedPriceDomain = requestedMinPrice !== null
			&& requestedMaxPrice !== null
			&& requestedMaxPrice > requestedMinPrice
			&& requestedMinPrice <= observedMinPrice
			&& requestedMaxPrice >= observedMaxPrice;
		const minPrice = usesFixedPriceDomain ? requestedMinPrice : observedMinPrice;
		const maxPrice = usesFixedPriceDomain ? requestedMaxPrice : observedMaxPrice;
		const priceSpan = Math.max(maxPrice - minPrice, Math.abs(minPrice) * 1e-6, 1e-6);
		const binSize = priceSpan / resolvedBinCount;
		const weights = Array(resolvedBinCount).fill(0);
		const survivalReady = candles.every((candle) => candle.turnoverRate !== null);
		const hasSaturatedTurnoverRate = survivalReady
			&& candles.some((candle) => candle.turnoverRate >= 1);
		const applyTurnoverSurvival = survivalReady && !hasSaturatedTurnoverRate;
		let totalInputVolume = 0;
		let turnoverRateTotal = 0;

		candles.forEach((candle) => {
			if (applyTurnoverSurvival) {
				const retention = 1 - candle.turnoverRate;
				for (let index = 0; index < weights.length; index += 1) {
					weights[index] *= retention;
				}
				turnoverRateTotal += candle.turnoverRate;
			}
			totalInputVolume += candle.volume;
			const typicalPrice = (candle.high + candle.low + candle.close) / 3;
			const candleRange = Math.max(candle.high - candle.low, binSize);
			const sigma = Math.max(candleRange / 3, binSize * MIN_SIGMA_BINS);
			const firstBin = Math.max(0, Math.floor((candle.low - minPrice) / binSize));
			const lastBin = Math.min(
				resolvedBinCount - 1,
				Math.floor((candle.high - minPrice) / binSize),
			);
			const contributions = [];
			let contributionTotal = 0;
			for (let index = firstBin; index <= lastBin; index += 1) {
				const binLow = minPrice + (index * binSize);
				const binHigh = index === resolvedBinCount - 1 ? maxPrice : binLow + binSize;
				const overlap = candle.high === candle.low
					? (index === firstBin ? binSize : 0)
					: Math.max(0, Math.min(candle.high, binHigh) - Math.max(candle.low, binLow));
				if (overlap <= 0) continue;
				const overlapMidpoint = (Math.max(candle.low, binLow) + Math.min(candle.high, binHigh)) / 2;
				const distance = (overlapMidpoint - typicalPrice) / sigma;
				const contribution = overlap * Math.exp(-0.5 * distance * distance);
				if (contribution <= 0) continue;
				contributions.push({index, contribution});
				contributionTotal += contribution;
			}
			if (contributionTotal <= 0) {
				const nearestBin = Math.max(
					0,
					Math.min(resolvedBinCount - 1, Math.floor((typicalPrice - minPrice) / binSize)),
				);
				weights[nearestBin] += candle.volume;
				return;
			}
			contributions.forEach(({index, contribution}) => {
				weights[index] += candle.volume * (contribution / contributionTotal);
			});
		});

		const resolvedShares = finiteNumber(circulatingShares ?? floatShares);
		return createDistribution({
			minPrice,
			maxPrice,
			binCount: resolvedBinCount,
			weights,
			categoryWeights: {
				buy: Array(resolvedBinCount).fill(0),
				neutral: weights,
				sell: Array(resolvedBinCount).fill(0),
			},
			source: "ohlcv-estimate",
			estimated: true,
			metadata: {
				model: applyTurnoverSurvival ? "turnover-survival" : "ohlcv-estimate",
				decayApplied: applyTurnoverSurvival,
				priceDomainFixed: usesFixedPriceDomain,
				shareBasis: applyTurnoverSurvival ? (shareBasis || (resolvedShares ? "circulating-shares" : "turnover-rate")) : "",
				circulatingShares: resolvedShares,
				totalInputVolume,
				averageTurnoverRate: applyTurnoverSurvival ? turnoverRateTotal / candles.length : null,
			},
		});
	};

	const calculatePriceLevelDistribution = (rows, {binCount = DEFAULT_BIN_COUNT} = {}) => {
		const levels = (Array.isArray(rows) ? rows : [])
			.map((row) => ({
				price: finiteNumber(row?.price),
				buy: Math.max(0, finiteNumber(row?.buy) || 0),
				neutral: Math.max(0, finiteNumber(row?.neutral) || 0),
				sell: Math.max(0, finiteNumber(row?.sell) || 0),
			}))
			.map((row) => ({...row, weight: row.buy + row.neutral + row.sell}))
			.filter((row) => row.price !== null && row.price > 0 && row.weight > 0);
		if (!levels.length) return null;
		const resolvedBinCount = clampBinCount(binCount);
		const rawMin = Math.min(...levels.map((row) => row.price));
		const rawMax = Math.max(...levels.map((row) => row.price));
		const padding = rawMax === rawMin ? Math.max(Math.abs(rawMin) * 0.001, 0.01) : 0;
		const minPrice = rawMin - padding;
		const maxPrice = rawMax + padding;
		const priceSpan = Math.max(maxPrice - minPrice, 1e-6);
		const categoryWeights = {
			buy: Array(resolvedBinCount).fill(0),
			neutral: Array(resolvedBinCount).fill(0),
			sell: Array(resolvedBinCount).fill(0),
		};
		levels.forEach(({price, buy, neutral, sell}) => {
			const index = Math.max(
				0,
				Math.min(resolvedBinCount - 1, Math.floor(((price - minPrice) / priceSpan) * resolvedBinCount)),
			);
			categoryWeights.buy[index] += buy;
			categoryWeights.neutral[index] += neutral;
			categoryWeights.sell[index] += sell;
		});
		return createDistribution({
			minPrice,
			maxPrice,
			binCount: resolvedBinCount,
			weights: categoryWeights.buy.map((buy, index) => (
				buy + categoryWeights.neutral[index] + categoryWeights.sell[index]
			)),
			categoryWeights,
			source: "longbridge-trade-stats",
			estimated: false,
		});
	};

	const shortestWeightedRange = (bins, fraction, totalWeight) => {
		if (!bins.length || totalWeight <= 0) return null;
		const target = Math.max(0, Math.min(1, fraction)) * totalWeight;
		let best = null;
		for (let start = 0; start < bins.length; start += 1) {
			let accumulated = 0;
			for (let end = start; end < bins.length; end += 1) {
				accumulated += Math.max(0, bins[end].weight || 0);
				if (accumulated < target) continue;
				const low = bins[start].low;
				const high = bins[end].high;
				const width = Math.max(0, high - low);
				const density = accumulated / Math.max(width, 1e-12);
				if (
					!best
					|| width < best.width - 1e-12
					|| (Math.abs(width - best.width) <= 1e-12 && density > best.density)
				) {
					best = {low, high, width, density};
				}
				break;
			}
		}
		return best ? [best.low, best.high] : null;
	};

	const calculateChipStatistics = (distribution, currentPrice) => {
		const bins = Array.isArray(distribution?.bins) ? distribution.bins : [];
		const totalWeight = finiteNumber(distribution?.totalWeight) || 0;
		const current = finiteNumber(currentPrice);
		if (!bins.length || totalWeight <= 0) return null;
		const weightedAverageCost = bins.reduce(
			(total, bin) => total + (bin.price * bin.weight),
			0,
		) / totalWeight;
		let profitableWeight = 0;
		if (current !== null) {
			bins.forEach((bin) => {
				if (current >= bin.high) {
					profitableWeight += bin.weight;
				} else if (current > bin.low && bin.high > bin.low) {
					profitableWeight += bin.weight * ((current - bin.low) / (bin.high - bin.low));
				}
			});
		}
		return {
			pocPrice: finiteNumber(distribution.pocPrice),
			weightedAverageCost,
			profitRatio: current === null ? null : profitableWeight / totalWeight,
			costRange70: shortestWeightedRange(bins, 0.70, totalWeight) || [null, null],
			costRange90: shortestWeightedRange(bins, 0.90, totalWeight) || [null, null],
			costRangeMethod: "shortest-contiguous-high-density",
			totalWeight,
		};
	};

	globalThis.ANTIGRAVITY_CHIP_DISTRIBUTION = Object.freeze({
		calculateChipDistribution,
		calculateChipStatistics,
		calculatePriceLevelDistribution,
		constants: Object.freeze({DEFAULT_BIN_COUNT, MIN_BIN_COUNT, MAX_BIN_COUNT}),
	});
})();
