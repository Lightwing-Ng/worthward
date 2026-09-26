/* Code version: v1.1.1 */
(() => {
    const create = (context) => {
        const {
            $,
            labels,
            state,
            theme,
        } = context;

        const CHART_CONTEXT_HOST_SELECTOR = [
            ".chart-wrap",
            ".trade-chart-canvas-wrap",
            ".investment-equity-chart-stage",
            ".investment-stock-details-price-chart-stage",
            ".live-trading-chart-shell",
            "[data-investment-stock-price-chart]",
            ".chart-surface",
        ].join(", ");
        const CHART_CONTEXT_MENU_ID = "chart_context_menu";
        let activeChartContextCanvas = null;

        const isExportableChartCanvas = (canvas) => {
            if (!(canvas instanceof HTMLCanvasElement)) return false;
            if (canvas.width <= 0 || canvas.height <= 0) return false;
            return Boolean(window.Chart?.getChart?.(canvas));
        };

        const resolveChartCanvasFromTarget = (target) => {
            if (!(target instanceof Element)) return null;
            const directCanvas = target.closest("canvas");
            if (isExportableChartCanvas(directCanvas)) return directCanvas;
            const chartHost = target.closest(CHART_CONTEXT_HOST_SELECTOR);
            const hostedCanvas = chartHost?.querySelector?.("canvas");
            return isExportableChartCanvas(hostedCanvas) ? hostedCanvas : null;
        };

        const slugifyChartFilenamePart = (value) => {
            const normalized = String(value || "")
                .trim()
                .toLowerCase()
                .replace(/&/g, " and ")
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "");
            return normalized || "chart";
        };

        const buildChartSvgFilename = (canvas) => {
            const surface = canvas.closest(".chart-surface") || canvas.parentElement;
            const heading = surface?.querySelector?.(".chart-heading")?.textContent
                || canvas.getAttribute("aria-label")
                || document.title
                || "chart";
            const baseName = slugifyChartFilenamePart(heading);
            const idSuffix = slugifyChartFilenamePart(canvas.id || "");
            if (!idSuffix || idSuffix === "chart" || baseName.includes(idSuffix)) return `${baseName}.svg`;
            return `${baseName}-${idSuffix}.svg`;
        };

        const escapeSvgAttribute = (value) => String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        const escapeSvgText = (value) => String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        const readChartExportBackground = (canvas) => {
            const candidates = [
                canvas.closest(".chart-wrap, .trade-chart-canvas-wrap, .investment-equity-chart-stage, .investment-stock-details-price-chart-stage, .live-trading-chart-shell"),
                canvas.closest(".chart-surface"),
                document.body,
            ].filter(Boolean);
            for (const candidate of candidates) {
                const color = getComputedStyle(candidate).backgroundColor;
                if (color && color !== "transparent" && !/rgba\([^,]+,[^,]+,[^,]+,\s*0\s*\)/i.test(color)) {
                    return color;
                }
            }
            return getComputedStyle(document.body).getPropertyValue("--theme-panel").trim() || "#ffffff";
        };

        const readChartFontFamily = (canvas) => {
            const computed = getComputedStyle(canvas);
            return computed.fontFamily || '"Univers Next for HSBC"';
        };

        const readChartTickFontSize = (canvas, fallbackValue = 12) => {
            const raw = getComputedStyle(canvas).getPropertyValue("--workspace-share-chart-axis-font-size").trim();
            const parsed = Number.parseFloat(raw);
            return Number.isFinite(parsed) ? parsed : fallbackValue;
        };

        const formatSvgNumber = (value) => {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return "0";
            return String(Math.round(numeric * 1000) / 1000);
        };

        const formatSvgPercentLabel = (value) => {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return "";
            return `${numeric.toLocaleString("en-US", { maximumFractionDigits: 0 })}%`;
        };

        const normalizeSvgDateLabel = (value) => {
            const raw = String(value || "");
            const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
            if (!match) return raw;
            const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
            const day = date.getUTCDate();
            const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
            const year = date.getUTCFullYear();
            if (match[4] && match[5] && (match[4] !== "00" || match[5] !== "00")) return `${match[4]}:${match[5]}\n${day} ${month} ${year}`;
            return `${day} ${month}\n${year}`;
        };

        const buildSvgLinePath = (points) => {
            const commands = [];
            let isOpen = false;
            points.forEach((point) => {
                const x = Number(point?.x);
                const y = Number(point?.y);
                const skipped = Boolean(point?.skip) || !Number.isFinite(x) || !Number.isFinite(y);
                if (skipped) {
                    isOpen = false;
                    return;
                }
                commands.push(`${isOpen ? "L" : "M"} ${formatSvgNumber(x)} ${formatSvgNumber(y)}`);
                isOpen = true;
            });
            return commands.join(" ");
        };

        const toFiniteSvgNumber = (value) => {
            const numeric = Number(value);
            return Number.isFinite(numeric) ? numeric : null;
        };

        const getSvgRawDateMinuteOfDay = (value) => {
            const match = String(value || "").match(/(?:[T ](\d{2}):(\d{2}))$/);
            if (!match) return null;
            const hours = Number(match[1]);
            const minutes = Number(match[2]);
            if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
            return (hours * 60) + minutes;
        };

        const getSvgRawDateSerialMinute = (value) => {
            const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
            if (!match) return null;
            const year = Number(match[1]);
            const month = Number(match[2]);
            const day = Number(match[3]);
            const hours = match[4] ? Number(match[4]) : 0;
            const minutes = match[5] ? Number(match[5]) : 0;
            if (![year, month, day, hours, minutes].every(Number.isFinite)) return null;
            return Math.floor(Date.UTC(year, month - 1, day) / 60000) + (hours * 60) + minutes;
        };

        // The shared axis module owns the serialized market-session projection
        // from `app/core/markets/sessions.py` and the one timezone-offset
        // implementation. This exporter keeps only its own bar-edge geometry.
        const chartAxisApi = () => window.WORTHWARD_CHART_AXIS || {};

        const resolveSvgMarketTimeConfig = (ticker) => chartAxisApi().resolveMarketTimeConfig(ticker);

        const getSvgTimezoneOffsetMinutes = (timezone, utcMs) => (
            chartAxisApi().getTimezoneOffsetMinutes(timezone, utcMs)
        );

        const localSvgMarketMinuteToNewYorkSerialMinute = (dateText, marketMinute, config) => (
            config
                ? chartAxisApi().marketMinuteToNewYorkSerialMinute(dateText, marketMinute, config.timezone)
                : null
        );

        const buildSvgOneDayTimestampRatio = (sourceSeries, rawDates) => {
            const hasCrossMarketRange = sourceSeries.some((item) => /\.(AS|AX|BA|BE|BK|BO|BR|CA|CN|CO|DE|DU|F|HA|HE|HK|HM|IR|IS|JK|JP|KL|KQ|KS|L|MC|MI|MX|NE|NS|NZ|OL|PA|QA|SA|SE|SG|SH|SI|SR|SS|ST|SW|SZ|TA|T|TO|TWO|TW|V|VI)$/i.test(String(item?.ticker || "")));
            if (hasCrossMarketRange) {
                const selectedTradingDate = String(state.chart?.tradingDate || rawDates.find(Boolean) || "");
                const sessionWindows = sourceSeries.flatMap((item) => {
                    const config = resolveSvgMarketTimeConfig(item?.ticker);
                    const openMinute = localSvgMarketMinuteToNewYorkSerialMinute(selectedTradingDate, config?.openMinute, config);
                    // `barEndMinute` is the exclusive end of the last included
                    // minute bar, so the half-minute step below lands exactly on
                    // that bar's right edge instead of clipping a closing-auction
                    // bar stamped on the session boundary itself.
                    const closeBoundaryMinute = localSvgMarketMinuteToNewYorkSerialMinute(selectedTradingDate, config?.barEndMinute, config);
                    if (!Number.isFinite(openMinute) || !Number.isFinite(closeBoundaryMinute)) return [];
                    return [{
                        startBoundary: openMinute - 0.5,
                        closeBoundary: closeBoundaryMinute - 0.5,
                    }];
                });
                if (sessionWindows.length) {
                    const startBoundary = Math.min(...sessionWindows.map((item) => item.startBoundary));
                    const endBoundary = Math.max(...sessionWindows.map((item) => item.closeBoundary));
                    const totalMinutes = endBoundary - startBoundary;
                    if (totalMinutes > 0) {
                        return (value) => {
                            const serialMinute = getSvgRawDateSerialMinute(value);
                            if (!Number.isFinite(serialMinute)) return null;
                            return Math.min(1, Math.max(0, (serialMinute - startBoundary) / totalMinutes));
                        };
                    }
                }
            }

            const hasExtendedHours = rawDates.some((value) => {
                const minuteOfDay = getSvgRawDateMinuteOfDay(value);
                return Number.isFinite(minuteOfDay) && (minuteOfDay < ((9 * 60) + 30) || minuteOfDay >= (16 * 60));
            });
            const sessionStart = hasExtendedHours ? (4 * 60) : ((9 * 60) + 30);
            const sessionEnd = hasExtendedHours ? (20 * 60) : (16 * 60);
            const totalSessionMinutes = sessionEnd - sessionStart;
            return (value) => {
                const minuteOfDay = getSvgRawDateMinuteOfDay(value);
                if (!Number.isFinite(minuteOfDay) || totalSessionMinutes <= 0) return null;
                return Math.min(1, Math.max(0, (minuteOfDay - sessionStart) / totalSessionMinutes));
            };
        };

        const buildSvgCandlestickMarkup = ({ chart, chartArea, yScale, textColor }) => {
            const sourceSeries = Array.isArray(state.chart?.series) ? state.chart.series : [];
            const labels = Array.isArray(chart.data?.labels) ? chart.data.labels : [];
            const rawDates = Array.isArray(sourceSeries[0]?.raw_dates) ? sourceSeries[0].raw_dates : [];
            const hasCandles = labels.length > 0
                && rawDates.length === labels.length
                && sourceSeries.length === chart.data.datasets.length
                && sourceSeries.every((item) => Array.isArray(item?.candlestick_returns) && item.candlestick_returns.length === labels.length);
            if (!hasCandles) return "";

            const timestampRatio = buildSvgOneDayTimestampRatio(sourceSeries, rawDates);
            const datasetCount = Math.max(sourceSeries.length, 1);
            const hasExtendedHours = rawDates.some((value) => {
                const minuteOfDay = getSvgRawDateMinuteOfDay(value);
                return Number.isFinite(minuteOfDay) && (minuteOfDay < ((9 * 60) + 30) || minuteOfDay >= (16 * 60));
            });
            const sessionStart = hasExtendedHours ? (4 * 60) : ((9 * 60) + 30);
            const sessionEnd = hasExtendedHours ? (20 * 60) : (16 * 60);
            const sessionMinuteWidth = (chartArea.right - chartArea.left) / Math.max(1, sessionEnd - sessionStart);
            const groupWidth = Math.max(1, Math.min(sessionMinuteWidth * 0.78, 8));
            const candleWidth = Math.max(0.55, groupWidth / datasetCount);
            return sourceSeries.map((item, datasetIndex) => {
                const dataset = chart.data.datasets[datasetIndex] || {};
                const strokeColor = dataset.borderColor || item.color || textColor;
                const xOffset = (datasetIndex - ((datasetCount - 1) / 2)) * candleWidth;
                const candleMarkup = item.candlestick_returns.map((candle, candleIndex) => {
                    const high = toFiniteSvgNumber(candle?.h);
                    const low = toFiniteSvgNumber(candle?.l);
                    const open = toFiniteSvgNumber(candle?.o);
                    const close = toFiniteSvgNumber(candle?.c);
                    const volume = toFiniteSvgNumber(candle?.v);
                    if (candle?.synthetic === true) return "";
                    if (volume !== null && volume <= 0) return "";
                    if (![high, low, open, close].every((value) => value !== null)) return "";
                    const xRatio = timestampRatio(rawDates[candleIndex]);
                    if (!Number.isFinite(xRatio)) return "";
                    const x = chartArea.left + ((chartArea.right - chartArea.left) * xRatio) + xOffset;
                    const highY = yScale.getPixelForValue(high);
                    const lowY = yScale.getPixelForValue(low);
                    const openY = yScale.getPixelForValue(open);
                    const closeY = yScale.getPixelForValue(close);
                    if (![x, highY, lowY, openY, closeY].every(Number.isFinite)) return "";
                    const bodyTop = Math.min(openY, closeY);
                    const bodyHeight = Math.max(0.55, Math.abs(closeY - openY));
                    const bodyLeft = x - (candleWidth / 2);
                    return [
                        `<line class="candle-wick" x1="${formatSvgNumber(x)}" y1="${formatSvgNumber(highY)}" x2="${formatSvgNumber(x)}" y2="${formatSvgNumber(lowY)}"/>`,
                        `<rect class="candle-body" x="${formatSvgNumber(bodyLeft)}" y="${formatSvgNumber(bodyTop)}" width="${formatSvgNumber(candleWidth)}" height="${formatSvgNumber(bodyHeight)}"/>`,
                    ].join("");
                }).join("");
                if (!candleMarkup) return "";
                return [
                    `<g class="candlestick-series" data-series="${escapeSvgAttribute(item.ticker || dataset.label || `series-${datasetIndex + 1}`)}" stroke="${escapeSvgAttribute(strokeColor)}" fill="${escapeSvgAttribute(strokeColor)}" fill-opacity="0.28" stroke-width="0.55">`,
                    candleMarkup,
                    "</g>",
                ].join("");
            }).join("");
        };

        const buildSvgTextLines = ({ text, x, y, lineHeight, anchor = "middle", className = "", fill = "currentColor" }) => {
            const lines = String(text || "").split("\n").filter((line) => line !== "");
            if (!lines.length) return "";
            const classAttr = className ? ` class="${escapeSvgAttribute(className)}"` : "";
            return [
                `<text${classAttr} x="${formatSvgNumber(x)}" y="${formatSvgNumber(y)}" text-anchor="${anchor}" fill="${escapeSvgAttribute(fill)}">`,
                ...lines.map((line, index) => (
                    `<tspan x="${formatSvgNumber(x)}" dy="${index === 0 ? 0 : formatSvgNumber(lineHeight)}">${escapeSvgText(line)}</tspan>`
                )),
                "</text>",
            ].join("");
        };

        const buildVectorChartSvgMarkup = (canvas, chart) => {
            const rect = canvas.getBoundingClientRect();
            const displayWidth = Math.max(1, Math.round(rect.width || canvas.clientWidth || canvas.width));
            const displayHeight = Math.max(1, Math.round(rect.height || canvas.clientHeight || canvas.height));
            const background = readChartExportBackground(canvas);
            const chartArea = chart.chartArea;
            const yScale = chart.scales?.y;
            const xScale = chart.scales?.x;
            if (!chartArea || !yScale || !xScale) throw new Error("Chart scales are not available for vector export.");

            const computed = getComputedStyle(document.body);
            const mutedColor = computed.getPropertyValue("--theme-muted").trim() || "#5f6b7a";
            const textColor = computed.getPropertyValue("--theme-text").trim() || "#111111";
            const zeroColor = computed.getPropertyValue("--theme-muted").trim() || "#8a94a3";
            const fontFamily = readChartFontFamily(canvas);
            const axisFontSize = readChartTickFontSize(canvas);
            const lineHeight = Math.round(axisFontSize * 1.08);
            const labels = Array.isArray(chart.data?.labels) ? chart.data.labels : [];
            const labelIndexes = labels.length <= 1
                ? labels.map((_label, index) => index)
                : Array.from(new Set([
                    0,
                    Math.round((labels.length - 1) / (displayWidth >= 768 ? 3 : 2)),
                    ...(displayWidth >= 768 ? [Math.round(((labels.length - 1) * 2) / 3)] : []),
                    labels.length - 1,
                ])).sort((left, right) => left - right);

            const yTicks = Array.isArray(yScale.ticks) ? yScale.ticks : [];
            const seriesLabels = [];
            const candlestickMarkup = buildSvgCandlestickMarkup({ chart, chartArea, yScale, textColor });
            const datasetMarkup = candlestickMarkup || chart.data.datasets.map((dataset, datasetIndex) => {
                const meta = chart.getDatasetMeta(datasetIndex);
                if (meta.hidden || dataset.hidden) return "";
                const pathData = buildSvgLinePath(meta.data || []);
                if (!pathData) return "";
                const color = dataset.borderColor || dataset.backgroundColor || textColor;
                const lineWidth = Number(dataset.borderWidth || 1.5);
                const lastPoint = [...(meta.data || [])].reverse().find((point) => !point?.skip && Number.isFinite(point?.x) && Number.isFinite(point?.y));
                if (dataset.label) {
                    seriesLabels.push(buildSvgTextLines({
                        text: dataset.label,
                        x: Math.min(displayWidth - 2, Number(lastPoint?.x || chartArea.right) + 14),
                        y: Number(lastPoint?.y || chartArea.top) + 4,
                        lineHeight,
                        anchor: "start",
                        className: "series-label",
                        fill: color,
                    }));
                }
                return [
                    `<g class="series" data-series="${escapeSvgAttribute(dataset.label || `series-${datasetIndex + 1}`)}">`,
                    `<path class="series-line" d="${pathData}" fill="none" stroke="${escapeSvgAttribute(color)}" stroke-width="${formatSvgNumber(lineWidth)}" stroke-linecap="round" stroke-linejoin="round"/>`,
                    "</g>",
                ].join("");
            }).join("");

            const yTickMarkup = yTicks.map((tick, index) => {
                if (index === 0 || index === yTicks.length - 1) return "";
                const y = yScale.getPixelForValue(tick.value);
                if (!Number.isFinite(y)) return "";
                return buildSvgTextLines({
                    text: formatSvgPercentLabel(tick.value),
                    x: chartArea.left - 10,
                    y: y + (axisFontSize * 0.35),
                    lineHeight,
                    anchor: "end",
                    className: "axis-label y-axis-label",
                    fill: mutedColor,
                });
            }).join("");

            const xTickMarkup = labelIndexes.map((index, tickIndex) => {
                const x = xScale.getPixelForValue(index);
                if (!Number.isFinite(x)) return "";
                let anchor = "middle";
                if (tickIndex === 0) anchor = "start";
                else if (tickIndex === labelIndexes.length - 1) anchor = "end";
                return buildSvgTextLines({
                    text: normalizeSvgDateLabel(labels[index]),
                    x,
                    y: chartArea.bottom + axisFontSize + 4,
                    lineHeight,
                    anchor,
                    className: "axis-label x-axis-label",
                    fill: mutedColor,
                });
            }).join("");

            const zeroY = yScale.getPixelForValue(0);
            const zeroLineMarkup = Number.isFinite(zeroY) && zeroY >= chartArea.top && zeroY <= chartArea.bottom
                ? `<path class="zero-line" d="M ${formatSvgNumber(chartArea.left + 8)} ${formatSvgNumber(zeroY)} L ${formatSvgNumber(chartArea.right - 8)} ${formatSvgNumber(zeroY)}" fill="none" stroke="${escapeSvgAttribute(zeroColor)}" stroke-width="1"/>`
                : "";

            return [
                `<svg xmlns="http://www.w3.org/2000/svg" width="${displayWidth}" height="${displayHeight}" viewBox="0 0 ${displayWidth} ${displayHeight}" role="img">`,
                "<title>Editable vector chart export</title>",
                "<desc>Chart geometry exported as SVG paths and text from Chart.js data, without embedding a raster screenshot.</desc>",
                `<style>text{font-family:${escapeSvgText(fontFamily)};font-size:${formatSvgNumber(axisFontSize)}px;font-weight:400}.series-label{font-size:${formatSvgNumber(Math.max(9, axisFontSize * 0.86))}px;font-weight:500}</style>`,
                `<rect width="${displayWidth}" height="${displayHeight}" fill="${escapeSvgAttribute(background)}"/>`,
                `<clipPath id="chart-plot-clip"><rect x="${formatSvgNumber(chartArea.left)}" y="${formatSvgNumber(chartArea.top)}" width="${formatSvgNumber(chartArea.right - chartArea.left)}" height="${formatSvgNumber(chartArea.bottom - chartArea.top)}"/></clipPath>`,
                `<g class="axis y-axis">${yTickMarkup}</g>`,
                `<g class="axis x-axis">${xTickMarkup}</g>`,
                `<g class="plot-guides">${zeroLineMarkup}</g>`,
                `<g class="plot-series" clip-path="url(#chart-plot-clip)">${datasetMarkup}</g>`,
                `<g class="series-labels">${seriesLabels.join("")}</g>`,
                "</svg>",
            ].join("");
        };

        const buildChartSvgMarkup = (canvas) => {
            const chart = window.Chart?.getChart?.(canvas);
            if (!chart) throw new Error("Only Chart.js canvases can be exported as editable SVG.");
            return buildVectorChartSvgMarkup(canvas, chart);
        };

        const downloadBlobFile = (filename, blob) => {
            const link = document.createElement("a");
            const url = URL.createObjectURL(blob);
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        };

        const closeChartContextMenu = () => {
            const menu = document.getElementById(CHART_CONTEXT_MENU_ID);
            if (menu) {
                menu.hidden = true;
                menu.classList.remove("is-open");
            }
            activeChartContextCanvas = null;
        };

        const downloadActiveChartSvg = () => {
            const canvas = activeChartContextCanvas;
            closeChartContextMenu();
            if (!isExportableChartCanvas(canvas)) return;
            try {
                const svg = buildChartSvgMarkup(canvas);
                downloadBlobFile(
                    buildChartSvgFilename(canvas),
                    new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
                );
            } catch (_error) {
                window.alert("SVG export failed. The chart contains an image that this browser cannot export.");
            }
        };

        const ensureChartContextMenu = () => {
            let menu = document.getElementById(CHART_CONTEXT_MENU_ID);
            if (menu) return menu;
            menu = document.createElement("div");
            menu.id = CHART_CONTEXT_MENU_ID;
            menu.className = "chart-context-menu";
            menu.setAttribute("role", "menu");
            menu.hidden = true;
            menu.innerHTML = `
                <button type="button" class="chart-context-menu-item" role="menuitem" data-chart-context-action="download-svg">
                    <span class="icon chart-context-menu-icon" style="-webkit-mask-image: url(/static/images/tray.and.arrow.down.fill.svg); mask-image: url(/static/images/tray.and.arrow.down.fill.svg);" aria-hidden="true"></span>
                    <span>Download SVG</span>
                </button>
            `;
            menu.addEventListener("click", (event) => {
                const action = event.target instanceof Element
                    ? event.target.closest("[data-chart-context-action]")?.dataset.chartContextAction
                    : "";
                if (action === "download-svg") downloadActiveChartSvg();
            });
            document.body.appendChild(menu);
            return menu;
        };

        const positionChartContextMenu = (menu, clientX, clientY) => {
            menu.hidden = false;
            menu.classList.add("is-open");
            menu.style.left = "0px";
            menu.style.top = "0px";
            const rect = menu.getBoundingClientRect();
            const margin = 8;
            const left = Math.min(
                Math.max(margin, clientX),
                Math.max(margin, window.innerWidth - rect.width - margin),
            );
            const top = Math.min(
                Math.max(margin, clientY),
                Math.max(margin, window.innerHeight - rect.height - margin),
            );
            menu.style.left = `${Math.round(left)}px`;
            menu.style.top = `${Math.round(top)}px`;
        };

        document.addEventListener("contextmenu", (event) => {
            const canvas = resolveChartCanvasFromTarget(event.target);
            if (!canvas) {
                closeChartContextMenu();
                return;
            }
            event.preventDefault();
            activeChartContextCanvas = canvas;
            positionChartContextMenu(ensureChartContextMenu(), event.clientX, event.clientY);
        });
        document.addEventListener("pointerdown", (event) => {
            const menu = document.getElementById(CHART_CONTEXT_MENU_ID);
            if (!menu || menu.hidden || menu.contains(event.target)) return;
            closeChartContextMenu();
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") closeChartContextMenu();
        });
        window.addEventListener("resize", closeChartContextMenu);
        window.addEventListener("scroll", closeChartContextMenu, true);


        return Object.freeze({
            CHART_CONTEXT_HOST_SELECTOR,
            CHART_CONTEXT_MENU_ID,
            activeChartContextCanvas,
            buildChartSvgFilename,
            buildChartSvgMarkup,
            buildSvgCandlestickMarkup,
            buildSvgLinePath,
            buildSvgOneDayTimestampRatio,
            buildSvgTextLines,
            buildVectorChartSvgMarkup,
            closeChartContextMenu,
            downloadActiveChartSvg,
            downloadBlobFile,
            ensureChartContextMenu,
            escapeSvgAttribute,
            escapeSvgText,
            formatSvgNumber,
            formatSvgPercentLabel,
            getSvgRawDateMinuteOfDay,
            getSvgRawDateSerialMinute,
            getSvgTimezoneOffsetMinutes,
            isExportableChartCanvas,
            localSvgMarketMinuteToNewYorkSerialMinute,
            normalizeSvgDateLabel,
            positionChartContextMenu,
            readChartExportBackground,
            readChartFontFamily,
            readChartTickFontSize,
            resolveChartCanvasFromTarget,
            resolveSvgMarketTimeConfig,
            slugifyChartFilenamePart,
            toFiniteSvgNumber,
        });
    };

    window.WORTHWARD_APP_CHART_EXPORT = Object.freeze({create});
})();
