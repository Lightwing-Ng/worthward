/**
 * Personal remaining-lot distribution presentation.
 * Code version: v1.5.1
 */

const quantityFormatter = new Intl.NumberFormat('en-US', {maximumFractionDigits: 6});
const priceFormatter = new Intl.NumberFormat('en-US', {maximumFractionDigits: 4});
const dateFormatter = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
});

function formatSnapshotDate(value) {
    const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
    if (!match) return '';
    const date = new Date(`${match[1]}T00:00:00Z`);
    if (!Number.isFinite(date.valueOf())) return '';
    return `${dateFormatter.format(date)}${match[2] ? ` ${match[2]}` : ''}`;
}

export function applyInvestmentStockDetailsHorizontalGuideStyle(context, theme = {}) {
    context.strokeStyle = theme.mutedSoft || theme.muted;
    context.lineWidth = 1;
    context.setLineDash([]);
}

export function createInvestmentStockDetailsChipChart(card, {resolveTheme, getPriceChart} = {}) {
    const canvas = card?.querySelector('[data-investment-stock-chips-canvas]');
    if (!canvas) return null;
    const emptyLabel = card.querySelector('[data-investment-stock-chips-empty]');
    let activeSnapshot = null;
    let destroyed = false;

    const draw = (providedChart) => {
        if (destroyed || !canvas.isConnected) return;
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const ratio = Math.max(1, window.devicePixelRatio || 1);
        canvas.width = Math.round(rect.width * ratio);
        canvas.height = Math.round(rect.height * ratio);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);
        canvas._investmentChipGeometry = {bins: [], labels: [], referenceLine: null};
        if (activeSnapshot?.status !== 'ready') return;

        const chart = providedChart?.scales?.y ? providedChart : getPriceChart?.();
        const yScale = chart?.scales?.y;
        const chartArea = chart?.chartArea;
        if (!yScale || !chartArea || !chart.canvas?.isConnected || !(chart.height > 0)) return;
        const sourceRect = chart.canvas.getBoundingClientRect();
        const sourceScale = sourceRect.height / chart.height;
        const priceY = (price) => sourceRect.top + yScale.getPixelForValue(price) * sourceScale - rect.top;
        const top = Math.max(0, sourceRect.top + chartArea.top * sourceScale - rect.top);
        const bottom = Math.min(rect.height, sourceRect.top + chartArea.bottom * sourceScale - rect.top);
        const minimum = Math.min(yScale.min, yScale.max);
        const maximum = Math.max(yScale.min, yScale.max);
        const geometry = {bins: [], labels: [], referenceLine: null, top, bottom, minimum, maximum, canvasTop: rect.top};
        canvas._investmentChipGeometry = geometry;
        if (!(bottom > top)) return;

        const theme = resolveTheme?.() || {};
        const style = getComputedStyle(card);
        ctx.font = `11px ${style.fontFamily}`;
        const bins = activeSnapshot.bins.filter((bin) => bin.price >= minimum && bin.price <= maximum);
        const currentPrice = activeSnapshot.price;
        const rows = new Map();
        bins.forEach((bin) => {
            const row = rows.get(bin.price) || {price: bin.price, quantity: 0, bins: []};
            row.quantity += bin.quantity;
            row.bins.push(bin);
            rows.set(bin.price, row);
        });
        const labels = [...rows.values()].map((row) => quantityFormatter.format(row.quantity));
        const labelWidth = Math.min(rect.width * 0.45, Math.max(0, ...labels.map((label) => ctx.measureText(label).width)) + 8);
        const left = labelWidth;
        const right = Math.max(left + 1, rect.width - 2);
        const paintedRows = [...rows.values()].map((row) => ({...row, y: priceY(row.price)}))
            .sort((a, b) => a.y - b.y);
        const maxPaintedQuantity = Math.max(1e-9, ...paintedRows.map((row) => row.quantity));
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, top, rect.width, bottom - top);
        ctx.clip();
        paintedRows.forEach((row, index) => {
            const previousGap = index ? row.y - paintedRows[index - 1].y : Number.POSITIVE_INFINITY;
            const nextGap = index + 1 < paintedRows.length
                ? paintedRows[index + 1].y - row.y : Number.POSITIVE_INFINITY;
            // Dense levels retain their exact source-axis center and at least
            // one physical pixel of ink; isolated levels need not become thin.
            const barHeight = Math.max(1 / ratio, Math.min(5, Math.min(previousGap, nextGap) * 0.8));
            let x = left;
            row.bins.forEach((bin) => {
                const width = (bin.quantity / maxPaintedQuantity) * (right - left);
                ctx.fillStyle = bin.profitable === null
                    ? theme.muted
                    : bin.profitable ? theme.accentPositive : theme.accentSecondary;
                ctx.fillRect(x, row.y - barHeight / 2, width, barHeight);
                geometry.bins.push({
                    price: bin.price, quantity: bin.quantity, side: bin.side,
                    x, y: row.y, pageY: rect.top + row.y, width, height: barHeight,
                });
                x += width;
            });
        });
        ctx.fillStyle = theme.muted || style.color;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const labeledRows = [];
        [...rows.values()].sort((a, b) => b.quantity - a.quantity || b.price - a.price).forEach((row) => {
            const y = priceY(row.price);
            if (labeledRows.some((previousY) => Math.abs(previousY - y) < 15)) return;
            const text = quantityFormatter.format(row.quantity);
            ctx.fillText(text, left - 6, y, Math.max(1, labelWidth - 8));
            geometry.labels.push({text, quantity: row.quantity, price: row.price, x: left - 6, y, align: ctx.textAlign});
            labeledRows.push(y);
        });
        if (Number.isFinite(currentPrice)) {
            const y = priceY(currentPrice);
            applyInvestmentStockDetailsHorizontalGuideStyle(ctx, theme);
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(right, y);
            ctx.stroke();
            geometry.referenceLine = {color: ctx.strokeStyle, lineWidth: ctx.lineWidth, dash: ctx.getLineDash(), left, right, y};
        }
        ctx.restore();
    };

    const render = (snapshot) => {
        if (destroyed || snapshot === activeSnapshot) return;
        activeSnapshot = snapshot;
        canvas._investmentChipSnapshot = snapshot;
        card.dataset.date = snapshot?.date || '';
        card.dataset.status = snapshot?.status || 'unavailable';
        card.dataset.totalQuantity = String(snapshot?.totalQuantity || 0);
        const ready = snapshot?.status === 'ready';
        emptyLabel.hidden = ready;
        emptyLabel.textContent = snapshot?.status === 'empty'
            ? 'No open lots at this time.'
            : 'Cost history unavailable.';
        canvas.setAttribute('aria-label', ready
            ? `Cost distribution on ${formatSnapshotDate(snapshot.date)}. ${snapshot.bins.map((bin) => (
                `${quantityFormatter.format(bin.quantity)} ${bin.side} shares at ${snapshot.currency} ${priceFormatter.format(bin.price)}${['carried-basis', 'cost-basis'].includes(bin.priceOrigin) ? ' (cost-basis anchor; original purchase price unavailable)' : ''}`
            )).join('; ')}.${Number.isFinite(snapshot.price) ? ` Reference line: last price ${priceFormatter.format(snapshot.price)}.` : ''}`
            : emptyLabel.textContent);
        draw();
    };
    const resizeObserver = window.ResizeObserver ? new ResizeObserver(draw) : null;
    resizeObserver?.observe(canvas);
    if (!resizeObserver) window.addEventListener('resize', draw);

    return {
        render,
        redraw: draw,
        destroy() {
            render(null);
            destroyed = true;
            resizeObserver?.disconnect();
            if (!resizeObserver) window.removeEventListener('resize', draw);
            canvas._investmentChipSnapshot = null;
            canvas._investmentChipGeometry = null;
        },
    };
}
