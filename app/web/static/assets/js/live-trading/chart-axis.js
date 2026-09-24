/* Code version: v1.0.0 */

export function createLiveTradingAxisPlugins({
    chartAxis,
    canvas,
    shell,
    hoverDateLabel,
    labels,
    closeValues,
    formatAxisLabel,
    formatPrice,
    formatStockPriceAxisValue,
    theme,
}) {
    const axisLabelLines = labels.map(formatAxisLabel);
    let axisLayoutKey = "";
    let axisLayoutTicks = [];
    let hoverDatePositionKey = "";
    let cachedBadgeBounds = null;

    const hideHoverDateLabel = () => {
        if (!hoverDatePositionKey && hoverDateLabel?.hidden) return;
        hoverDatePositionKey = "";
        cachedBadgeBounds = null;
        chartAxis.updateHoverDateLabel(hoverDateLabel, {lines: null});
    };

    const hoverGuidePlugin = {
        id: "liveTradingHoverGuidePlugin",
        afterDatasetsDraw(chartInstance) {
            const {ctx, chartArea, scales, tooltip} = chartInstance;
            const dataIndex = tooltip?.dataPoints?.[0]?.dataIndex;
            const close = Number(closeValues[dataIndex]);
            const x = Number(scales?.x?.getPixelForValue(dataIndex));
            const y = Number(scales?.y?.getPixelForValue(close));
            if (
                !chartArea
                || !tooltip
                || tooltip.opacity === 0
                || !Number.isInteger(dataIndex)
                || dataIndex < 0
                || !Number.isFinite(close)
                || !Number.isFinite(x)
                || !Number.isFinite(y)
                || x < chartArea.left
                || x > chartArea.right
                || y < chartArea.top
                || y > chartArea.bottom
            ) {
                chartInstance._activeLiveTradingGuideBounds = null;
                hideHoverDateLabel();
                return;
            }
            chartInstance._activeLiveTradingGuideBounds = {
                index: dataIndex,
                left: chartArea.left,
                right: chartArea.right,
                x,
                y,
                price: close,
            };
            ctx.save();
            ctx.strokeStyle = getComputedStyle(document.body)
                .getPropertyValue("--theme-muted-soft").trim() || theme.muted;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, chartArea.top);
            ctx.lineTo(x, chartArea.bottom);
            ctx.moveTo(chartArea.left, y);
            ctx.lineTo(chartArea.right, y);
            ctx.stroke();
            ctx.restore();
            chartAxis.drawYAxisValueBadge(chartInstance, {
                y,
                value: close,
                formattedValue: formatPrice(close),
                formatTickLabel: formatStockPriceAxisValue,
                fillColor: theme.accentPrimary,
                boundsProperty: "_activeLiveTradingGuideBounds",
            });

            const nextHoverDatePositionKey = [
                dataIndex,
                chartInstance.width,
                chartInstance.height,
                chartArea.left,
                chartArea.right,
                chartArea.bottom,
                x,
            ].join(":");
            if (nextHoverDatePositionKey !== hoverDatePositionKey || hoverDateLabel?.hidden) {
                hoverDatePositionKey = nextHoverDatePositionKey;
                cachedBadgeBounds = null;
                const canvasRect = canvas.getBoundingClientRect();
                const shellRect = shell?.getBoundingClientRect();
                const scaleX = chartInstance.width > 0 ? canvasRect.width / chartInstance.width : 0;
                const scaleY = chartInstance.height > 0 ? canvasRect.height / chartInstance.height : 0;
                chartAxis.updateHoverDateLabel(hoverDateLabel, {
                    lines: axisLabelLines[dataIndex],
                    x: shellRect && scaleX > 0 ? canvasRect.left - shellRect.left + (x * scaleX) : NaN,
                    top: shellRect && scaleY > 0
                        ? canvasRect.top - shellRect.top + (chartArea.bottom * scaleY)
                        : NaN,
                    width: shell?.clientWidth || 0,
                });
            }
        },
    };

    const xAxisLabelPlugin = {
        id: "liveTradingXAxisLabelPlugin",
        afterDraw(chartInstance) {
            const {ctx, chartArea, scales} = chartInstance;
            const xScale = scales?.x;
            if (!chartArea || !xScale || !labels.length) return;
            const baselineY = chartArea.bottom;
            const lineHeight = 10;
            ctx.save();
            ctx.fillStyle = theme.muted;
            ctx.font = `400 12px ${getComputedStyle(document.body).fontFamily}`;
            ctx.textBaseline = "top";
            const nextLayoutKey = [
                chartInstance.width,
                chartArea.left,
                chartArea.right,
                ctx.font,
                document.fonts?.status || "",
            ].join(":");
            if (nextLayoutKey !== axisLayoutKey) {
                axisLayoutKey = nextLayoutKey;
                axisLayoutTicks = chartAxis.layoutDateAxisTicks({
                    count: labels.length,
                    getPixel: (index) => xScale.getPixelForValue(index),
                    measureWidth: (index) => Math.max(
                        0,
                        ...axisLabelLines[index].map((line) => ctx.measureText(line).width),
                    ),
                    boundsLeft: 0,
                    boundsRight: chartInstance.width,
                    getKey: (index) => labels[index],
                });
            }
            if (!hoverDateLabel?.hidden && hoverDatePositionKey && !cachedBadgeBounds) {
                const canvasRect = canvas.getBoundingClientRect();
                const badgeRect = hoverDateLabel.getBoundingClientRect();
                const badgeScaleX = canvasRect.width > 0 ? chartInstance.width / canvasRect.width : 0;
                const badgeScaleY = canvasRect.height > 0 ? chartInstance.height / canvasRect.height : 0;
                if (badgeScaleX > 0 && badgeScaleY > 0) {
                    cachedBadgeBounds = {
                        left: (badgeRect.left - canvasRect.left) * badgeScaleX,
                        right: (badgeRect.right - canvasRect.left) * badgeScaleX,
                        top: (badgeRect.top - canvasRect.top) * badgeScaleY,
                        bottom: (badgeRect.bottom - canvasRect.top) * badgeScaleY,
                    };
                }
            }
            const badgeBounds = hoverDateLabel?.hidden ? null : cachedBadgeBounds;
            axisLayoutTicks.forEach((tick) => {
                const [firstLine, secondLine] = axisLabelLines[tick.index];
                ctx.textAlign = tick.align;
                if (badgeBounds && badgeBounds.bottom > baselineY && badgeBounds.top < baselineY + (2 * lineHeight)) {
                    const textWidth = Math.max(ctx.measureText(firstLine).width, ctx.measureText(secondLine).width);
                    const textLeft = tick.x - (
                        tick.align === "right" ? textWidth : tick.align === "center" ? textWidth / 2 : 0
                    );
                    if (textLeft < badgeBounds.right && textLeft + textWidth > badgeBounds.left) return;
                }
                ctx.fillText(firstLine, tick.x, baselineY);
                ctx.fillText(secondLine, tick.x, baselineY + lineHeight);
            });
            ctx.restore();
        },
    };

    return {hoverGuidePlugin, xAxisLabelPlugin};
}
