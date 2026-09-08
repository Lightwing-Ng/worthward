/* Code version: v1.1.0 */
(function bootstrapPriceFieldDistributions(globalScope) {
    "use strict";
    const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
    const MAX_ABS_AUTOREGRESSION = 0.95;
    // Abramowitz and Stegun 7.1.26; sufficient for visual probability mass.
    const normalCdf = (value) => {
        const z = Number(value);
        if (!Number.isFinite(z)) return z < 0 ? 0 : 1;
        const sign = z < 0 ? -1 : 1;
        const x = Math.abs(z) / Math.sqrt(2);
        const t = 1 / (1 + (0.3275911 * x));
        const coefficients = [
            0.254829592,
            -0.284496736,
            1.421413741,
            -1.453152027,
            1.061405429,
        ];
        const polynomial = (((((coefficients[4] * t) + coefficients[3]) * t + coefficients[2]) * t
            + coefficients[1]) * t + coefficients[0]) * t;
        const erf = sign * (1 - (polynomial * Math.exp(-(x * x))));
        return clamp(0.5 * (1 + erf), 0, 1);
    };

    const multiStepNormalParameters = ({
        mean,
        scale,
        horizon,
        autoregression = 0,
        longRunMean = 0,
        innovationScale = scale,
    } = {}) => {
        const oneStepMean = Number(mean);
        const oneStepScale = Number(scale);
        const steps = Number(horizon);
        const phi = clamp(Number(autoregression), -MAX_ABS_AUTOREGRESSION, MAX_ABS_AUTOREGRESSION);
        const equilibriumMean = Number(longRunMean);
        const nextInnovationScale = Number(innovationScale);
        if (!Number.isFinite(oneStepMean) || !(oneStepScale > 0)
            || !Number.isInteger(steps) || !(steps > 0)
            || !Number.isFinite(phi) || !Number.isFinite(equilibriumMean)
            || !(nextInnovationScale > 0)) return null;
        let stateMean = oneStepMean;
        let stateVariance = oneStepScale * oneStepScale;
        let cumulativeMean = stateMean;
        let cumulativeVariance = stateVariance;
        let cumulativeStateCovariance = stateVariance;
        const innovationVariance = nextInnovationScale * nextInnovationScale;
        for (let step = 1; step < steps; step += 1) {
            stateMean = equilibriumMean + (phi * (stateMean - equilibriumMean));
            const nextStateVariance = (phi * phi * stateVariance) + innovationVariance;
            const previousCumulativeNextStateCovariance = phi * cumulativeStateCovariance;
            cumulativeMean += stateMean;
            cumulativeVariance += nextStateVariance
                + (2 * previousCumulativeNextStateCovariance);
            cumulativeStateCovariance = previousCumulativeNextStateCovariance
                + nextStateVariance;
            stateVariance = nextStateVariance;
        }
        return Object.freeze({
            mean: cumulativeMean,
            scale: Math.sqrt(Math.max(Number.EPSILON, cumulativeVariance)),
        });
    };

    const probabilityBetweenPrices = ({
        anchorPrice,
        lowerPrice,
        upperPrice,
        mean,
        scale,
        horizon,
        autoregression,
        longRunMean,
        innovationScale,
    }) => {
        const anchor = Number(anchorPrice);
        const lower = Number(lowerPrice);
        const upper = Number(upperPrice);
        const forecast = multiStepNormalParameters({
            mean,
            scale,
            horizon,
            autoregression,
            longRunMean,
            innovationScale,
        });
        if (!(anchor > 0) || !(lower > 0) || !(upper > lower) || !forecast) {
            return 0;
        }
        const lowerZ = (Math.log(lower / anchor) - forecast.mean) / forecast.scale;
        const upperZ = (Math.log(upper / anchor) - forecast.mean) / forecast.scale;
        return clamp(normalCdf(upperZ) - normalCdf(lowerZ), 0, 1);
    };


    const gaussian = Object.freeze({
        probabilityBetweenPrices,
        probabilityAboveAnchor(parameters) {
            const forecast = multiStepNormalParameters(parameters);
            return forecast ? normalCdf(forecast.mean / forecast.scale) : null;
        },
    });

    // Each head predicts a cumulative log return directly. Never apply an AR
    // projection or extrapolate beyond the horizons learned by this model.
    const directNormalParameters = ({horizon, horizonMean, horizonStd} = {}) => {
        const index = Number(horizon) - 1;
        if (!Number.isInteger(index) || index < 0 || !Array.isArray(horizonMean)
            || !Array.isArray(horizonStd) || index >= horizonMean.length
            || index >= horizonStd.length) return null;
        const mean = horizonMean[index];
        const scale = horizonStd[index];
        if (typeof mean !== "number" || !Number.isFinite(mean)
            || typeof scale !== "number" || !Number.isFinite(scale) || !(scale > 0)) return null;
        return Object.freeze({mean, scale});
    };
    const directGaussian = Object.freeze({
        probabilityBetweenPrices(parameters) {
            const forecast = directNormalParameters(parameters);
            const anchor = Number(parameters.anchorPrice);
            const lower = Number(parameters.lowerPrice);
            const upper = Number(parameters.upperPrice);
            if (!forecast || !(anchor > 0) || !(lower > 0) || !(upper > lower)) return null;
            return clamp(normalCdf((Math.log(upper / anchor) - forecast.mean) / forecast.scale)
                - normalCdf((Math.log(lower / anchor) - forecast.mean) / forecast.scale), 0, 1);
        },
        probabilityAboveAnchor(parameters) {
            const forecast = directNormalParameters(parameters);
            return forecast ? normalCdf(forecast.mean / forecast.scale) : null;
        },
    });

    // Registries belong to a controller; extensions cannot mutate another chart.
    const createRegistry = (extensions = {}) => {
        const adapters = new Map([
            ["dynamic-normal-log-return", gaussian],
            ["lstm-gaussian-log-return", gaussian],
            ["direct-normal-horizon", directGaussian],
        ]);
        for (const [kind, adapter] of Object.entries(extensions)) {
            if (!kind || adapters.has(kind)
                || typeof adapter?.probabilityBetweenPrices !== "function"
                || typeof adapter?.probabilityAboveAnchor !== "function") {
                throw new TypeError(`Invalid or duplicate Price Field distribution: ${kind}`);
            }
            adapters.set(kind, Object.freeze({
                probabilityBetweenPrices: adapter.probabilityBetweenPrices.bind(adapter),
                probabilityAboveAnchor: adapter.probabilityAboveAnchor.bind(adapter),
            }));
        }
        return Object.freeze({
            // Older payloads omitted the kind and used the same Gaussian contract.
            resolve: (kind) => adapters.get(kind === undefined ? "dynamic-normal-log-return" : kind) || null,
        });
    };
    const api = Object.freeze({MAX_ABS_AUTOREGRESSION, createRegistry, gaussian, directGaussian, directNormalParameters, normalCdf, multiStepNormalParameters, probabilityBetweenPrices});
    globalScope.WORTHWARD_PRICE_FIELD_DISTRIBUTIONS = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
