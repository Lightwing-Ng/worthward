/**
 * Investment chart and donut orbit helpers.
 *
 * Code version: v1.36.2
 * - Added: Exported module version metadata so the investment entry module can expose loaded helper versions for cache diagnostics.
 */

export const INVESTMENT_CHART_ORBIT_MODULE_VERSION = 'v1.36.2';

const investmentDonutOrbitLayerState = new WeakMap();

export function getInvestmentDonutOrbitAnimationState(logoLayer) {
    if (!(logoLayer instanceof HTMLElement)) return null;
    return investmentDonutOrbitLayerState.get(logoLayer) || null;
}

function normalizeOrbitAngle(angle) {
    if (!Number.isFinite(angle)) return 0;
    const normalized = angle % 360;
    return normalized < 0 ? normalized + 360 : normalized;
}

function getShortestOrbitAngleDelta(fromAngle, toAngle) {
    const start = normalizeOrbitAngle(fromAngle);
    const end = normalizeOrbitAngle(toAngle);
    let delta = end - start;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    return delta;
}

function easeInOutCubic(progress) {
    if (window.AntigravityMotion?.easing?.inOut) {
        return window.AntigravityMotion.easing.inOut(progress);
    }
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    return progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - (Math.pow(-2 * progress + 2, 3) / 2);
}

export function getPortfolioDonutOrbitMetrics(orbitElement) {
    if (!(orbitElement instanceof HTMLElement)) return null;
    const computed = getComputedStyle(orbitElement);
    const donutSize = Number.parseFloat(computed.getPropertyValue('--portfolio-donut-orbit-donut-size'))
        || Number.parseFloat(computed.getPropertyValue('--portfolio-donut-size'))
        || 120;
    const logoSize = Number.parseFloat(computed.getPropertyValue('--portfolio-donut-orbit-logo-size'))
        || Number.parseFloat(computed.getPropertyValue('--portfolio-donut-logo-size'))
        || 20;
    const satelliteRadius = (logoSize * Math.SQRT2) / 2;
    const orbitRadius = (donutSize / 2) + satelliteRadius;
    const centerX = orbitElement.clientWidth / 2;
    const centerY = orbitElement.clientHeight / 2;
    const centerSeparationAngle = orbitRadius > 1e-6
        ? (2 * Math.asin(Math.min(1, satelliteRadius / orbitRadius)) * 180) / Math.PI
        : 0;
    return {
        centerX,
        centerY,
        donutSize,
        logoSize,
        satelliteRadius,
        orbitRadius,
        minSeparationAngle: Math.max(centerSeparationAngle * 0.8, 6),
    };
}

export function renderInvestmentDonutOrbitLogoPosition(
    logoElement,
    angle,
    orbitMetrics,
    radiusScale = 1,
    opacity = 1
) {
    if (!(logoElement instanceof HTMLElement) || !orbitMetrics) return;
    const radians = ((normalizeOrbitAngle(angle) - 90) * Math.PI) / 180;
    const x = orbitMetrics.centerX + (Math.cos(radians) * orbitMetrics.orbitRadius * radiusScale);
    const y = orbitMetrics.centerY + (Math.sin(radians) * orbitMetrics.orbitRadius * radiusScale);
    logoElement.style.left = `${x.toFixed(2)}px`;
    logoElement.style.top = `${y.toFixed(2)}px`;
    logoElement.style.opacity = `${Math.max(0, Math.min(1, opacity))}`;
}

export function resolveInvestmentDonutOrbitAngles(logoItems, orbitMetrics) {
    if (!Array.isArray(logoItems) || !logoItems.length || !orbitMetrics) return [];
    const minSeparationAngle = Math.max(orbitMetrics.minSeparationAngle || 0, 0);
    const sortedItems = logoItems
        .map((item, index) => ({
            ...item,
            originalIndex: index,
            desiredAngle: normalizeOrbitAngle(item.midAngle),
        }))
        .sort((left, right) => left.desiredAngle - right.desiredAngle);
    const resolvedAngles = new Array(sortedItems.length);
    const desiredAngles = sortedItems.map((item) => item.desiredAngle);

    sortedItems.forEach((item, index) => {
        if (index === 0) {
            resolvedAngles[index] = item.desiredAngle;
            return;
        }
        resolvedAngles[index] = Math.max(item.desiredAngle, resolvedAngles[index - 1] + minSeparationAngle);
    });

    const wrapLimit = resolvedAngles[0] + 360 - minSeparationAngle;
    let overflow = Math.max(0, resolvedAngles[resolvedAngles.length - 1] - wrapLimit);
    if (overflow > 1e-6) {
        for (let index = resolvedAngles.length - 1; index > 0 && overflow > 1e-6; index -= 1) {
            const previousFloor = resolvedAngles[index - 1] + minSeparationAngle;
            const shiftBudget = Math.max(0, resolvedAngles[index] - Math.max(desiredAngles[index], previousFloor));
            if (shiftBudget <= 1e-6) continue;
            const appliedShift = Math.min(shiftBudget, overflow);
            resolvedAngles[index] -= appliedShift;
            overflow -= appliedShift;
        }
    }

    const result = new Array(sortedItems.length);
    sortedItems.forEach((item, index) => {
        result[item.originalIndex] = normalizeOrbitAngle(resolvedAngles[index]);
    });
    return result;
}

function ensureInvestmentDonutOrbitLayerState(logoLayer) {
    let state = investmentDonutOrbitLayerState.get(logoLayer);
    if (state) return state;
    state = {
        animationFrame: 0,
        logos: new Map(),
        orbitMetrics: null,
    };
    investmentDonutOrbitLayerState.set(logoLayer, state);
    return state;
}

function stopInvestmentDonutOrbitLayerAnimation(layerState) {
    if (!layerState?.animationFrame) return;
    window.cancelAnimationFrame(layerState.animationFrame);
    layerState.animationFrame = 0;
}

function scheduleInvestmentDonutOrbitLayerAnimation(logoLayer) {
    if (!(logoLayer instanceof HTMLElement)) return;
    const layerState = ensureInvestmentDonutOrbitLayerState(logoLayer);
    if (layerState.animationFrame) return;
    const step = (now) => {
        const orbitMetrics = layerState.orbitMetrics
            || getPortfolioDonutOrbitMetrics(logoLayer.closest('.portfolio-donut-orbit'));
        if (orbitMetrics) layerState.orbitMetrics = orbitMetrics;
        let hasActiveAnimation = false;
        layerState.logos.forEach((entry) => {
            const logoElement = entry.element;
            if (!(logoElement instanceof HTMLImageElement) || !logoElement.isConnected || !orbitMetrics) return;
            const animationStartTime = Number.isFinite(entry.animationStartTime) ? entry.animationStartTime : now;
            const duration = Math.max(1, Number(entry.duration) || 1);
            const progress = Math.max(0, Math.min(1, (now - animationStartTime) / duration));
            const easedProgress = easeInOutCubic(progress);
            const currentAngle = entry.startAngle + (entry.deltaAngle * easedProgress);
            const currentRadiusScale = entry.startRadiusScale + ((entry.targetRadiusScale - entry.startRadiusScale) * easedProgress);
            const currentOpacity = entry.startOpacity + ((entry.targetOpacity - entry.startOpacity) * easedProgress);
            entry.currentAngle = normalizeOrbitAngle(currentAngle);
            entry.currentRadiusScale = currentRadiusScale;
            entry.currentOpacity = currentOpacity;
            renderInvestmentDonutOrbitLogoPosition(
                logoElement,
                entry.currentAngle,
                orbitMetrics,
                currentRadiusScale,
                currentOpacity
            );
            if (progress >= 1) {
                entry.startAngle = entry.currentAngle;
                entry.deltaAngle = 0;
                entry.startRadiusScale = currentRadiusScale;
                entry.targetRadiusScale = currentRadiusScale;
                entry.startOpacity = currentOpacity;
                entry.targetOpacity = currentOpacity;
                entry.animationStartTime = now;
                if (entry.isExiting) {
                    logoElement.remove();
                    layerState.logos.delete(entry.ticker);
                }
            } else {
                hasActiveAnimation = true;
            }
        });
        if (hasActiveAnimation) {
            layerState.animationFrame = window.requestAnimationFrame(step);
        } else {
            stopInvestmentDonutOrbitLayerAnimation(layerState);
        }
    };
    layerState.animationFrame = window.requestAnimationFrame(step);
}

export function syncInvestmentDonutOrbitLogos(logoLayer, logoItems) {
    if (!(logoLayer instanceof HTMLElement)) return;
    const orbitElement = logoLayer.closest('.portfolio-donut-orbit');
    const orbitMetrics = getPortfolioDonutOrbitMetrics(orbitElement);
    if (!orbitMetrics) return;
    const layerState = ensureInvestmentDonutOrbitLayerState(logoLayer);
    layerState.orbitMetrics = orbitMetrics;
    const existingLogos = new Map(
        Array.from(logoLayer.querySelectorAll('.portfolio-donut-logo')).map((logo) => [logo.dataset.ticker || '', logo])
    );
    const nextTickers = new Set();
    const resolvedAngles = resolveInvestmentDonutOrbitAngles(logoItems, orbitMetrics);

    logoItems.forEach((item, index) => {
        const ticker = item.ticker;
        const targetAngle = Number.isFinite(resolvedAngles[index]) ? resolvedAngles[index] : normalizeOrbitAngle(item.midAngle);
        nextTickers.add(ticker);
        let logo = existingLogos.get(ticker);
        if (!(logo instanceof HTMLImageElement)) {
            logo = document.createElement('img');
            logo.className = 'portfolio-donut-logo is-orbit-animated';
            logo.dataset.ticker = ticker;
            logo.alt = `${ticker} logo`;
            logo.src = item.logoUrl;
            logo.dataset.styleTokenDonutAngle = targetAngle.toFixed(2);
            logoLayer.appendChild(logo);
            renderInvestmentDonutOrbitLogoPosition(logo, targetAngle, orbitMetrics, 1.85, 0);
        } else {
            if (logo.src !== item.logoUrl) logo.src = item.logoUrl;
            logo.classList.add('is-orbit-animated');
            logo.dataset.styleTokenDonutAngle = targetAngle.toFixed(2);
        }

        let entry = layerState.logos.get(ticker);
        if (!entry) {
            entry = {
                ticker,
                element: logo,
                currentAngle: targetAngle,
                currentRadiusScale: 1.85,
                currentOpacity: 0,
                startAngle: targetAngle,
                deltaAngle: 0,
                startRadiusScale: 1.85,
                targetRadiusScale: 1,
                startOpacity: 0,
                targetOpacity: 1,
                animationStartTime: performance.now(),
                duration: 620,
                isExiting: false,
            };
            layerState.logos.set(ticker, entry);
        } else {
            entry.element = logo;
            entry.ticker = ticker;
            const angleDelta = getShortestOrbitAngleDelta(entry.currentAngle, targetAngle);
            const shouldRetarget = entry.isExiting
                || Math.abs(angleDelta) > 0.05
                || Math.abs((entry.targetRadiusScale ?? 1) - 1) > 1e-3
                || Math.abs((entry.targetOpacity ?? 1) - 1) > 1e-3;
            entry.isExiting = false;
            if (shouldRetarget) {
                entry.startAngle = entry.currentAngle;
                entry.deltaAngle = angleDelta;
                entry.startRadiusScale = entry.currentRadiusScale;
                entry.targetRadiusScale = 1;
                entry.startOpacity = entry.currentOpacity;
                entry.targetOpacity = 1;
                entry.animationStartTime = performance.now();
                entry.duration = 520;
            }
        }

        if (item.className) {
            logo.classList.add(...String(item.className).split(/\s+/).filter(Boolean));
        }
        logo.classList.remove('is-exiting');
    });

    existingLogos.forEach((logo, ticker) => {
        if (nextTickers.has(ticker)) return;
        const entry = layerState.logos.get(ticker);
        logo.classList.add('is-exiting');
        if (!entry) {
            window.setTimeout(() => {
                if (logo.classList.contains('is-exiting')) logo.remove();
            }, 220);
            return;
        }
        entry.isExiting = true;
        entry.startAngle = entry.currentAngle;
        entry.deltaAngle = 0;
        entry.startRadiusScale = entry.currentRadiusScale;
        entry.targetRadiusScale = 1.18;
        entry.startOpacity = entry.currentOpacity;
        entry.targetOpacity = 0;
        entry.animationStartTime = performance.now();
        entry.duration = 220;
    });

    scheduleInvestmentDonutOrbitLayerAnimation(logoLayer);
}

export function registerInvestmentChartHelpers(targetWindow = window) {
    targetWindow.drawMultipleLineChart = function(container, data, options) {
        const canvas = document.createElement('canvas');
        container.appendChild(canvas);

        const theme = targetWindow.ANTIGRAVITY_APP.theme;
        const themePrimaryColor = String(theme?.accent_primary || '').trim();
        const themeSecondaryColor = String(theme?.accent_secondary || '').trim();
        const themeMutedColor = String(theme?.muted || '').trim();
        const resolvedTheme = (() => {
            const computed = getComputedStyle(document.body);
            return {
                text: computed.getPropertyValue('--theme-text').trim() || String(theme?.text || '').trim(),
                muted: computed.getPropertyValue('--theme-muted').trim() || themeMutedColor,
                accentPrimary: computed.getPropertyValue('--theme-accent-primary').trim() || themePrimaryColor,
                accentSecondary: computed.getPropertyValue('--theme-accent-secondary').trim() || themeSecondaryColor,
            };
        })();

        const hexToRgba = (hex, alpha) => {
            const raw = hex.replace('#', '');
            const r = parseInt(raw.substring(0, 2), 16);
            const g = parseInt(raw.substring(2, 4), 16);
            const b = parseInt(raw.substring(4, 6), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        };

        const allValues = data.series.flatMap((series) => series.values);
        const minValue = Math.min(...allValues);
        const maxValue = Math.max(...allValues);
        const padding = (maxValue - minValue) * 0.1 || 1;

        const ctx = canvas.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
        gradient.addColorStop(0, resolvedTheme.accentPrimary);
        gradient.addColorStop(1, resolvedTheme.accentSecondary);

        const datasets = data.series.map((series, idx) => {
            const color = series.color || (idx === 0 ? gradient : resolvedTheme.accentSecondary);
            return {
                label: series.name,
                data: series.values,
                borderColor: color,
                backgroundColor: color,
                borderWidth: 3,
                pointRadius: 0,
                pointHoverRadius: 6,
                pointBackgroundColor: '#ffffff',
                pointBorderColor: resolvedTheme.accentPrimary,
                pointBorderWidth: 2,
                fill: true,
                tension: 0.4,
                backgroundColor: (context) => {
                    const chart = context.chart;
                    const { ctx: chartContext, chartArea } = chart;
                    if (!chartArea) return null;
                    const fillGradient = chartContext.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                    fillGradient.addColorStop(0, hexToRgba(idx === 0 ? resolvedTheme.accentPrimary : resolvedTheme.accentSecondary, 0.15));
                    fillGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
                    return fillGradient;
                },
            };
        });

        return new Chart(canvas, {
            type: 'line',
            data: {
                labels: data.labels,
                datasets,
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 8, right: 8, bottom: 22, left: 4 } },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        align: 'end',
                        labels: {
                            color: resolvedTheme.muted,
                            boxWidth: 10,
                            usePointStyle: true,
                            font: { family: "'Inter', sans-serif", size: 11, weight: '500' },
                        },
                    },
                    tooltip: {
                        enabled: true,
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        titleColor: '#1e293b',
                        bodyColor: '#1e293b',
                        borderColor: 'rgba(0, 0, 0, 0.05)',
                        borderWidth: 1,
                        padding: 12,
                        cornerRadius: 12,
                        displayColors: true,
                        boxPadding: 6,
                        usePointStyle: true,
                        callbacks: {
                            label: (context) => {
                                const value = context.parsed.y;
                                return ` ${context.dataset.label}: ${options.tooltipFormatter ? options.tooltipFormatter(value) : value}`;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: resolvedTheme.muted,
                            maxRotation: 0,
                            font: { size: 10 },
                        },
                    },
                    y: {
                        min: minValue - padding,
                        max: maxValue + padding,
                        grid: {
                            display: true,
                            color: 'rgba(148, 163, 184, 0.05)',
                            drawBorder: false,
                        },
                        ticks: {
                            color: resolvedTheme.muted,
                            font: { size: 10 },
                            callback: (value) => options.yAxisFormatter ? options.yAxisFormatter(value) : value,
                        },
                    },
                },
            },
        });
    };
}
