/* Live trading chart-axis behavior. Code version: v1.0.1 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveTradingAxisPlugins} from '../../../app/web/static/assets/js/live-trading/chart-axis.js';

test('lays out intraday ticks in pixel space and retains meaningful minutes', () => {
    const previousDocument = globalThis.document;
    const previousGetComputedStyle = globalThis.getComputedStyle;
    try {
        globalThis.document = {body: {}, fonts: {status: 'loaded'}};
        globalThis.getComputedStyle = () => ({fontFamily: 'Univers Next for HSBC'});
        const labels = [
            '2026-09-23 09:30',
            '2026-09-23 10:30',
            '2026-09-23 16:00',
        ];
        const layoutCalls = [];
        const drawnLabels = [];
        const chartAxis = {
            layoutDateAxisTicks(options) {
                layoutCalls.push({
                    count: options.count,
                    positions: labels.map((_label, index) => options.getPixel(index)),
                    width: options.measureWidth(1),
                    keys: labels.map((_label, index) => options.getKey(index)),
                });
                return [
                    {index: 0, x: 20, align: 'left'},
                    {index: 2, x: 180, align: 'right'},
                ];
            },
        };
        const {xAxisLabelPlugin} = createLiveTradingAxisPlugins({
            chartAxis,
            labels,
            closeValues: [100, 101, 102],
            formatAxisLabel: (value) => [value.slice(0, 10), value.slice(11)],
            theme: {muted: '#888'},
        });
        const chart = {
            width: 200,
            chartArea: {left: 20, right: 180, bottom: 100},
            scales: {x: {getPixelForValue: (index) => 20 + (index * 80)}},
            ctx: {
                save() {},
                restore() {},
                measureText: (value) => ({width: String(value).length * 6}),
                fillText: (value, x, y) => drawnLabels.push({value, x, y}),
            },
        };
        xAxisLabelPlugin.afterDraw(chart);
        xAxisLabelPlugin.afterDraw(chart);
        assert.equal(layoutCalls.length, 1, 'unchanged hover redraws reuse measured ticks');
        assert.deepEqual(layoutCalls[0], {
            count: 3,
            positions: [20, 100, 180],
            width: 60,
            keys: labels,
        });
        assert.deepEqual(drawnLabels.slice(0, 4).map((entry) => entry.value), [
            '2026-09-23', '09:30', '2026-09-23', '16:00',
        ]);
        chart.width = 220;
        xAxisLabelPlugin.afterDraw(chart);
        assert.equal(layoutCalls.length, 2, 'resize remeasures tick geometry');
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousGetComputedStyle === undefined) delete globalThis.getComputedStyle;
        else globalThis.getComputedStyle = previousGetComputedStyle;
    }
});

test('ties both guides and axis badges to the hovered close and clears them on exit', () => {
    const previousDocument = globalThis.document;
    const previousGetComputedStyle = globalThis.getComputedStyle;
    try {
        globalThis.document = {body: {}};
        globalThis.getComputedStyle = () => ({
            fontFamily: 'Univers Next for HSBC',
            getPropertyValue: () => '#888888',
        });
        const strokes = [];
        const badges = [];
        const dates = [];
        const drawnLabels = [];
        const rectCalls = {canvas: 0, shell: 0, badge: 0};
        const canvas = {getBoundingClientRect: () => {
            rectCalls.canvas += 1;
            return {left: 12, top: 30, width: 400, height: 240};
        }};
        const shell = {clientWidth: 420, getBoundingClientRect: () => {
            rectCalls.shell += 1;
            return {left: 10, top: 20};
        }};
        const dateLabel = {hidden: true, getBoundingClientRect: () => {
            rectCalls.badge += 1;
            return {left: 180, right: 230, top: 220, bottom: 240};
        }};
        const chartAxis = {
            drawYAxisValueBadge: (_chart, options) => badges.push(options),
            updateHoverDateLabel: (element, options) => {
                element.hidden = !options.lines;
                dates.push({element, options});
            },
            layoutDateAxisTicks: () => [
                {index: 0, x: 20, align: 'left'},
                {index: 1, x: 100, align: 'center'},
            ],
        };
        const {hoverGuidePlugin, xAxisLabelPlugin} = createLiveTradingAxisPlugins({
            chartAxis,
            canvas,
            shell,
            hoverDateLabel: dateLabel,
            labels: ['2026-09-23 09:30', '2026-09-23 10:30'],
            closeValues: [120, 123.45],
            formatAxisLabel: (value) => [value.slice(0, 10), value.slice(11)],
            formatPrice: (value) => Number(value).toFixed(2),
            formatStockPriceAxisValue: (value) => String(value),
            theme: {muted: '#999', accentPrimary: '#0055cc'},
        });
        const chart = {
            width: 200,
            height: 120,
            chartArea: {left: 20, right: 180, top: 10, bottom: 100},
            scales: {
                x: {getPixelForValue: () => 100},
                y: {getPixelForValue: () => 55},
            },
            tooltip: {opacity: 1, dataPoints: [{dataIndex: 1}]},
            ctx: {
                save() {},
                restore() {},
                beginPath() {},
                measureText: (value) => ({width: String(value).length * 6}),
                fillText: (value) => drawnLabels.push(value),
                moveTo: (x, y) => strokes.push(['move', x, y]),
                lineTo: (x, y) => strokes.push(['line', x, y]),
                stroke() {},
            },
        };
        hoverGuidePlugin.afterDatasetsDraw(chart);
        assert.deepEqual(strokes, [
            ['move', 100, 10], ['line', 100, 100],
            ['move', 20, 55], ['line', 180, 55],
        ]);
        assert.equal(chart._activeLiveTradingGuideBounds.price, 123.45);
        assert.equal(badges[0].formattedValue, '123.45');
        assert.equal(badges[0].fillColor, '#0055cc');
        assert.deepEqual(dates.at(-1), {
            element: dateLabel,
            options: {lines: ['2026-09-23', '10:30'], x: 202, top: 210, width: 420},
        });
        xAxisLabelPlugin.afterDraw(chart);
        assert.deepEqual(drawnLabels, ['2026-09-23', '09:30'], 'badge hides the intersecting static tick');
        const previousRectCalls = {...rectCalls};
        hoverGuidePlugin.afterDatasetsDraw(chart);
        xAxisLabelPlugin.afterDraw(chart);
        assert.deepEqual(rectCalls, previousRectCalls, 'same-index hover avoids repeated layout reads');
        assert.equal(dates.length, 1, 'same-index hover avoids repositioning the badge');
        dateLabel.hidden = true;
        hoverGuidePlugin.afterDatasetsDraw(chart);
        assert.equal(dates.length, 2, 'an externally hidden badge is restored on the next hover');
        chart.tooltip.opacity = 0;
        hoverGuidePlugin.afterDatasetsDraw(chart);
        assert.equal(chart._activeLiveTradingGuideBounds, null);
        assert.deepEqual(dates.at(-1).options, {lines: null});
        xAxisLabelPlugin.afterDraw(chart);
        assert.deepEqual(drawnLabels.slice(-4), [
            '2026-09-23', '09:30', '2026-09-23', '10:30',
        ], 'static ticks return when the hover badge hides');
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousGetComputedStyle === undefined) delete globalThis.getComputedStyle;
        else globalThis.getComputedStyle = previousGetComputedStyle;
    }
});
