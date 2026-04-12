/**
 * Investment transaction tracker frontend.
 *
 * Code version: v1.30.0
 * - Fixed: Investment valuation now consumes bundled price history from the primary transactions payload, reports degraded states explicitly, and avoids per-ticker N+1 refresh fetches during first render
 * - Removed: Legacy manual-entry selector and transaction-form branches that no longer match the current Investment template contract
 * - Improved: Investment chart hover now scrolls the full same-day Transaction history row group into view instead of centering only the first matching row
 * - Added: Investment segmented control now appends a fourth "Stock details" view with same-page holdings links and animated pill focus
 * - Added: Stock details view now shows a selected ticker identity block, a standard donut shell, and a per-ticker detail table with realized P&L per transaction
 * - Improved: Trade effective price and realized P&L calculations now account for separate commissions in manual buy and sell rows
 * - Added: Settings action button import flow now exposes explicit disabled and in-progress states, including present-participle copy while the task is running
 * - Changed: Investment Charts now render one equity point per market day, filling no-trade trading days from parquet closes and collapsing same-day multi-trade activity into a single daily close snapshot
 * - Changed: Non-trading days with investment ledger activity now render on the curve using the previous available market close, while hover only anchors to history rows on dates that actually have ledger activity
 * - Fixed: Investment equity canvas now respects responsive container width at medium breakpoints instead of overflowing around 900 px layouts
 * - Fixed: Investment equity tooltip now uses viewport-safe positioning so frosted glass popovers no longer clip against ancestor overflow or screen edges
 * - Added: Charts hover now anchors and highlights all same-day Transaction history rows via the shared metric-style history locator
 * - Added: Holdings row hover now anchors and highlights the latest matching Transaction history row for that ticker via the shared metric-style history locator
 * - Improved: Metric, chart, and holdings interactions now share the same history-row highlight lifecycle and clear hover state on exit
 * - Fixed: Investment template, CSS, and JS now share the same chart-surface container contract again via investment_view_surface
 * - Improved: Transaction history rows now render through reusable cell classes instead of per-cell inline styles
 * - Improved: Holdings logos now use delegated fallback handling instead of inline onerror handlers
 * - Improved: Funding metric cards now render from a shared definition list instead of repeated hard-coded markup
 * - Fixed: Transaction processing no longer mutates the original API payload order while building the ledger view
 * - Fixed: Holdings header spelling now uses "Realized P&L"
 * - Reduced: Investment page accent colors now resolve through theme tokens instead of repeated hard-coded hex values
 * - Fixed: Holdings now keep a stable logo slot, so missing or failed ticker logos no longer break row alignment
 * - Fixed: Investment transaction payload now retries profile-based logo resolution when a local logo asset is missing
 * - Updated: Import feedback now appears as a top floating modal-banner notice with iOS-style drop-in motion
 * - Fixed: Import feedback copy no longer repeats the success prefix returned by the backend
 * - Updated: Investment segmented control now shows "Charts"
 * - Added: Export the Holdings and Transaction history tables as a Markdown download from the page header
 * - Fixed: Investment equity curve now starts from the first real transaction point instead of a synthetic zero-value seed
 * - Improved: Investment equity tooltip now shows equity, market value, and cash from the processed ledger snapshot
 * - Updated: Investment equity hover guide now matches the compare chart vertical hover line behavior
 * - Updated: Investment equity series color is fixed to #0055cc to match the tooltip legend
 * - Reworked: Holdings view now renders as a scrollable data table with per-ticker cost basis and P&L metrics
 * - Improved: Holdings and Metrics data now consistently use the Workspace metric value token
 * - Fixed: Investment view segmented control now switches cleanly between Chart, Holdings, and Metrics
 * - Fixed: Equity curve only renders inside the Chart view instead of bleeding into other tabs
 * - Fixed: Dashboard rendering no longer crashes on undefined transactions or parquet scope references
 * - Fixed: Total Equity calculation uses historical close prices from parquet files instead of latest prices for each transaction date
 * - Improved: Investment equity curve now reuses the shared chart tooltip tokens and layout
 * - Fixed: Equity curve seeds a zero-value point on the prior day when the first transaction starts above or below zero
 * - Adjusted: Investment chart panel better fills the available card height in Chart view
 * - Updated: Transaction history description format to TICKER@quantity for buy/sell operations
 * - Fixed: Cash calculation logic for payment_in_lieu and foreign tax withholding transactions
 * - Improved: Adjusted transaction table column widths for better readability
 * - Renamed: "Tax withholding" → "Foreign tax withholding" (value: tax_withholding → foreign_tax_withholding) for consistent naming
 * - Improved: Toggle button now switches plus/minus icons via reusable CSS classes
 * - Fixed: Transaction table header uses opaque background (var(--panel-strong)) instead of semi-transparent glass for better text readability
 * - Adjusted: Finalized transaction table column widths and min-widths per layout requirements
 * - Fixed: Added backward compatibility - normalize space-separated type names to snake_case for existing imported transactions (e.g., "foreign tax withholding" → foreign_tax_withholding)
 * - Improved: Show '-' instead of 0.00 in Commission column for transaction types that don't normally have commission (foreign tax withholding, dividend, adjustment, debit interest, payment in lieu, dividend reinvestment, forex trade, deposit, withdrawal, credit interest)
 * - Fixed: Investment history table now keeps the scrollbar below the rounded header and stays bottom-aligned with the sidebar
 * - Fixed: Add transaction form now reuses the standard controls and action button styling
 * - Improved: Add transaction form offset now follows the measured form height instead of hard-coded pixels
 * - Fixed: Grant transactions now add shares without affecting cash, while history still shows their economic amount
 * - Fixed: Holdings average price now uses out-of-pocket cost, so grant lots dilute cost per share instead of adding cost basis
 * - Fixed: Grant descriptions now use the standard TICKER @ PRICE x QTY transaction format
 * - Updated: Holdings summary row now colors only the cumulative P&L value, keeping the label text neutral
 * - Reworked: The investment import form now accepts the two IBKR CSV exports instead of manual transaction entry
 * - Added: Import feedback now spells out that the server discards raw CSV files after in-memory processing
 * - Improved: Empty transaction history now shows a compact guided import state with inline plus icon and width protection
 * - Updated: Import feedback now uses the standard modal dialog banner message token instead of the legacy modal dialog block
 * - Fixed: IBKR deposit rows no longer invent a USD currency when the CSV does not prove one
 * - Fixed: Forex Trade Component rows now render a precise English description and show the destination currency
 * - Refined: Deposit rows now describe the amount as a USD-equivalent credit when the source CSV only proves the base value
 * - Refined: Forex Trade Component rows now use compact trade-style wording and always display the acquired currency
 * - Fixed: Investment view segmented pill now stays hidden until the active label is measured, preventing the loading-time stretched Charts highlight
 */

// Helper to draw a multi-series line chart directly on a container
window.drawMultipleLineChart = function(container, data, options) {
    // Create canvas element
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);

    const theme = window.ANTIGRAVITY_APP.theme;
    const resolvedTheme = (() => {
        const computed = getComputedStyle(document.body);
        return {
            text: computed.getPropertyValue("--theme-text").trim(),
            muted: computed.getPropertyValue("--theme-muted").trim(),
            accentPrimary: computed.getPropertyValue("--theme-accent-primary").trim(),
            accentSecondary: computed.getPropertyValue("--theme-accent-secondary").trim(),
        };
    })();

    const hexToRgba = (hex, alpha) => {
        const raw = hex.replace("#", "");
        const r = parseInt(raw.substring(0, 2), 16);
        const g = parseInt(raw.substring(2, 4), 16);
        const b = parseInt(raw.substring(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    const allValues = data.series.flatMap(s => s.values);
    const minValue = Math.min(...allValues);
    const maxValue = Math.max(...allValues);
    const padding = (maxValue - minValue) * 0.1 || 1;

    // Create Gradient for the stroke
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
                const {ctx, chartArea} = chart;
                if (!chartArea) return null;
                const fillGradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                fillGradient.addColorStop(0, hexToRgba(idx === 0 ? resolvedTheme.accentPrimary : resolvedTheme.accentSecondary, 0.15));
                fillGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
                return fillGradient;
            },
        };
    });

    const chart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: data.labels,
            datasets: datasets,
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
                        font: { family: "'Inter', sans-serif", size: 11, weight: '500' }
                    } 
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
                        font: { size: 10 }
                    },
                },
                y: {
                    min: minValue - padding,
                    max: maxValue + padding,
                    grid: { 
                        display: true,
                        color: 'rgba(148, 163, 184, 0.05)',
                        drawBorder: false
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

document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('toggle_form_button');
    const formContainer = document.getElementById('transaction_form_container');
    const historyTable = document.getElementById('history_table_wrap');
    const investmentForm = document.getElementById('investment_form');
    const importFeedback = document.getElementById('investment_import_feedback');
    const importFeedbackMessage = document.getElementById('investment_import_feedback_message');
    const importFeedbackIcon = document.getElementById('investment_import_feedback_icon');
    const transactionsCsvInput = document.getElementById('transactions_csv');
    const positionsCsvInput = document.getElementById('positions_csv');
    const transactionsCsvStatus = document.getElementById('transactions_csv_status');
    const positionsCsvStatus = document.getElementById('positions_csv_status');
    const importSubmitButton = document.getElementById('investment_import_submit_button');
    const segmentedControl = document.getElementById('investment_view_segmented');
    const investmentViewSurface = document.getElementById('investment_view_surface');
    const investmentViewSurfaceBody = document.getElementById('investment_view_surface_body');
    const investmentDummyChart = document.getElementById('investment_dummy_chart');
    const investmentDummyLogoLayer = document.getElementById('investment_dummy_logo_layer');
    const investmentDummyDonut = document.getElementById('investment_dummy_donut');
    const investmentStockDetailsPanel = document.getElementById('investment_stock_details_panel');
    const exportTransactionsButton = document.getElementById('export_transactions_button');
    const investmentPanels = document.querySelectorAll('[data-investment-view-panel]');
    const INVESTMENT_VIEW_ORDER = ['chart', 'holdings', 'stock_details', 'metrics'];
    const NO_COMMISSION_TRANSACTION_TYPES = new Set([
        'foreign_tax_withholding',
        'dividend',
        'adjustment',
        'debit_interest',
        'credit_interest',
        'payment_in_lieu',
        'dividend_reinvestment',
        'forex_trade',
        'forex_trade_component',
        'fx_translation_pnl',
        'deposit',
        'grant',
        'withdrawal',
    ]);
    const FUNDING_METRIC_DEFINITIONS = [
        {
            key: 'direct-deposits',
            label: 'Direct deposits',
            summary: 'Direct USD cash deposits that were not consumed by later USD conversions.',
            valueKey: 'directUsdDeposits',
            rowsKey: 'directDepositRows',
        },
        {
            key: 'net-usd-converted',
            label: 'Net USD converted',
            summary: 'USD received from FX conversion after subtracting conversion commissions.',
            valueKey: 'netUsdConverted',
            rowsKey: 'netUsdConvertedRows',
        },
        {
            key: 'fx-funding-loss',
            label: 'FX funding loss',
            summary: 'Real conversion cost only: FX commission plus the deposit-to-USD shortfall tied to matched conversion funding.',
            valueKey: 'fxFundingLoss',
            rowsKey: 'fxFundingLossRows',
        },
        {
            key: 'final-investable-usd',
            label: 'Final investable USD',
            summary: 'Direct USD deposits plus net USD obtained from FX conversion.',
            valueKey: 'finalInvestableUsd',
            rowsKey: 'finalInvestableUsdRows',
        },
    ];
    let activeInvestmentView = 'chart';
    let investmentSurfaceCleanupTimer = null;
    let investmentFormHideTimer = null;
    let investmentImportInFlight = false;
    let investmentSegmentedMeasureRaf = 0;
    let activeInvestmentHistoryRowIds = [];
    let activeInvestmentStockDetailRowIds = [];
    let investmentChartReady = false;
    let investmentHasExportableTransactions = false;
    let investmentEquityChartInstance = null;
    let activeHoldingsHoverTicker = '';
    let activeHoldingsHoverLedgerNo = 0;
    let investmentChartPointsCache = [];
    let investmentChartPointIndexByLedgerNo = new Map();
    let investmentLatestChartPoint = null;
    let activeChartTooltipPointIndex = -1;
    let investmentDummyTickerProfiles = {};
    let selectedInvestmentStockTicker = '';
    let investmentProcessedTransactionsCache = [];
    let investmentTickerSummariesCache = [];
    let animatedHoldingsMarkerPoint = null;
    let animatedHoldingsMarkerTarget = null;
    let animatedHoldingsMarkerFrame = 0;
    let animatedHoldingsMarkerStartTime = 0;

    function getActionButtonLabels(button) {
        return {
            defaultLabel: String(button?.dataset?.defaultLabel || button?.textContent || '').trim() || 'Continue',
            pendingLabel: String(button?.dataset?.pendingLabel || '').trim() || 'Working',
        };
    }

    function renderPendingActionLabel(pendingLabel) {
        return /ing$/i.test(pendingLabel) ? `${pendingLabel}...` : pendingLabel;
    }

    function syncActionButtonState(button, { disabled = false, pending = false } = {}) {
        if (!button) return;
        const labels = getActionButtonLabels(button);
        const isDisabled = Boolean(disabled || pending);
        button.disabled = isDisabled;
        button.classList.toggle('is-pending', Boolean(pending));
        button.setAttribute('aria-disabled', String(isDisabled));
        if (pending) {
            button.setAttribute('aria-busy', 'true');
            button.textContent = renderPendingActionLabel(labels.pendingLabel);
            return;
        }
        button.removeAttribute('aria-busy');
        button.textContent = labels.defaultLabel;
    }

    function clearInvestmentSegmentedMeasureRaf() {
        if (!investmentSegmentedMeasureRaf) return;
        window.cancelAnimationFrame(investmentSegmentedMeasureRaf);
        investmentSegmentedMeasureRaf = 0;
    }

    function updateInvestmentSegmentedPill() {
        if (!segmentedControl) return;
        const activeLabel = segmentedControl.querySelector('input[type="radio"]:checked + span');
        if (!activeLabel) {
            segmentedControl.classList.remove('is-pill-ready');
            return;
        }

        const controlRect = segmentedControl.getBoundingClientRect();
        const labelRect = activeLabel.getBoundingClientRect();
        const horizontalInset = 12;
        const measuredWidth = Math.max(0, Math.round(labelRect.width + horizontalInset * 2));
        const measuredLeft = Math.round((labelRect.left - controlRect.left) - horizontalInset);

        if (controlRect.width <= 0 || measuredWidth <= 0) {
            segmentedControl.classList.remove('is-pill-ready');
            return;
        }

        const maxLeft = Math.max(0, Math.round(controlRect.width - measuredWidth));
        const clampedLeft = Math.min(Math.max(0, measuredLeft), maxLeft);

        segmentedControl.style.setProperty('--investment-segmented-pill-left', `${clampedLeft}px`);
        segmentedControl.style.setProperty('--investment-segmented-pill-width', `${measuredWidth}px`);
        segmentedControl.classList.add('is-pill-ready');
    }

    function scheduleInvestmentSegmentedPillUpdate() {
        if (!segmentedControl) return;
        segmentedControl.classList.remove('is-pill-ready');
        clearInvestmentSegmentedMeasureRaf();
        investmentSegmentedMeasureRaf = window.requestAnimationFrame(() => {
            investmentSegmentedMeasureRaf = window.requestAnimationFrame(() => {
                investmentSegmentedMeasureRaf = 0;
                updateInvestmentSegmentedPill();
            });
        });
    }

    function lockInvestmentSurfaceHeight() {
        if (!investmentViewSurface) return;
        const currentHeight = investmentViewSurface.getBoundingClientRect().height;
        investmentViewSurface.style.height = `${currentHeight}px`;
        investmentViewSurface.style.overflow = 'clip';
    }

    function cleanupInvestmentSurfaceHeight() {
        if (!investmentViewSurface) return;
        investmentViewSurface.style.height = '';
        investmentViewSurface.style.overflow = '';
        if (investmentSurfaceCleanupTimer) {
            window.clearTimeout(investmentSurfaceCleanupTimer);
            investmentSurfaceCleanupTimer = null;
        }
    }

    function animateInvestmentSurfaceHeight() {
        if (!investmentViewSurface || !investmentViewSurfaceBody) return;
        if (!investmentViewSurface.style.height) {
            lockInvestmentSurfaceHeight();
        }
        void investmentViewSurface.offsetHeight;
        const targetHeight = investmentViewSurface.scrollHeight;
        investmentViewSurface.style.height = `${targetHeight}px`;
        if (investmentSurfaceCleanupTimer) {
            window.clearTimeout(investmentSurfaceCleanupTimer);
        }
        investmentSurfaceCleanupTimer = window.setTimeout(() => {
            cleanupInvestmentSurfaceHeight();
        }, 460);
    }

    function setInvestmentView(nextView) {
        if (!nextView) {
            return;
        }

        if (nextView === 'stock_details') {
            ensureSelectedInvestmentStockTicker();
        }

        if (nextView === activeInvestmentView) {
            if (nextView === 'stock_details') {
                refreshPortfolioDonutOrbits(investmentStockDetailsPanel);
            }
            return;
        }

        lockInvestmentSurfaceHeight();

        if (segmentedControl) {
            const activeIndex = Math.max(INVESTMENT_VIEW_ORDER.indexOf(nextView), 0);
            const nextRadio = segmentedControl.querySelector(`input[type="radio"][value="${CSS.escape(nextView)}"]`);
            if (nextRadio instanceof HTMLInputElement) {
                nextRadio.checked = true;
            }
            segmentedControl.dataset.active = nextView;
            segmentedControl.style.setProperty('--segmented-option-count', String(INVESTMENT_VIEW_ORDER.length));
            segmentedControl.style.setProperty('--segmented-active-index', String(activeIndex));
            scheduleInvestmentSegmentedPillUpdate();
        }
        if (investmentViewSurface) {
            investmentViewSurface.dataset.activeView = nextView;
        }
        investmentPanels.forEach((panel) => {
            panel.hidden = panel.dataset.investmentViewPanel !== nextView;
        });
        activeInvestmentView = nextView;
        animateInvestmentSurfaceHeight();
        if (nextView === 'stock_details') {
            window.requestAnimationFrame(() => {
                refreshPortfolioDonutOrbits(investmentStockDetailsPanel);
            });
        }
    }

    function initInvestmentViewTabs() {
        if (!segmentedControl) return;
        const radios = segmentedControl.querySelectorAll('input[type="radio"]');
        radios.forEach((radio) => {
            radio.addEventListener('change', () => {
                if (radio.checked) {
                    setInvestmentView(radio.value);
                }
            });
        });
        const checkedRadio = segmentedControl.querySelector('input[type="radio"]:checked');
        activeInvestmentView = '';
        syncInvestmentViewFromLocationHash(checkedRadio?.value || 'chart');
        scheduleInvestmentSegmentedPillUpdate();
        cleanupInvestmentSurfaceHeight();

        if (document.fonts?.ready && typeof document.fonts.ready.then === 'function') {
            document.fonts.ready.then(() => {
                scheduleInvestmentSegmentedPillUpdate();
            }).catch(() => {});
        }

        window.addEventListener('resize', scheduleInvestmentSegmentedPillUpdate);

        if (window.ResizeObserver) {
            const segmentedResizeObserver = new ResizeObserver(() => {
                scheduleInvestmentSegmentedPillUpdate();
            });
            segmentedResizeObserver.observe(segmentedControl);
            radios.forEach((radio) => {
                const optionLabel = radio.nextElementSibling;
                if (optionLabel instanceof HTMLElement) {
                    segmentedResizeObserver.observe(optionLabel);
                }
            });
        }

        window.addEventListener('hashchange', () => {
            syncInvestmentViewFromLocationHash(activeInvestmentView || 'chart');
        });
    }

    function interpolateHexColor(startHex, endHex, t) {
        const normalizedT = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
        const parseHex = (hex) => {
            const normalized = String(hex || '').replace('#', '');
            if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return { r: 0, g: 0, b: 0 };
            return {
                r: Number.parseInt(normalized.slice(0, 2), 16),
                g: Number.parseInt(normalized.slice(2, 4), 16),
                b: Number.parseInt(normalized.slice(4, 6), 16),
            };
        };
        const start = parseHex(startHex);
        const end = parseHex(endHex);
        const mix = (left, right) => Math.round(left + ((right - left) * normalizedT));
        const toHex = (value) => value.toString(16).padStart(2, '0');
        return `#${toHex(mix(start.r, end.r))}${toHex(mix(start.g, end.g))}${toHex(mix(start.b, end.b))}`;
    }

    function buildInvestmentDummyPalette(count) {
        if (!Number.isFinite(count) || count <= 0) return [];
        if (count === 1) return ['#0055cc'];
        return Array.from({ length: count }, (_, index) => {
            const ratio = index / (count - 1);
            return interpolateHexColor('#0055cc', '#ff2f92', ratio);
        });
    }

    function ensureAnimatedDonutLayers(donutElement) {
        if (!(donutElement instanceof HTMLElement)) return [];
        donutElement.classList.add('is-animated');
        let fillLayerA = donutElement.querySelector('.portfolio-donut-fill-layer-a');
        let fillLayerB = donutElement.querySelector('.portfolio-donut-fill-layer-b');
        if (!(fillLayerA instanceof HTMLElement)) {
            fillLayerA = document.createElement('span');
            fillLayerA.className = 'portfolio-donut-fill-layer portfolio-donut-fill-layer-a';
            donutElement.appendChild(fillLayerA);
        }
        if (!(fillLayerB instanceof HTMLElement)) {
            fillLayerB = document.createElement('span');
            fillLayerB.className = 'portfolio-donut-fill-layer portfolio-donut-fill-layer-b';
            donutElement.appendChild(fillLayerB);
        }
        return [fillLayerA, fillLayerB];
    }

    function applyAnimatedDonutFill(donutElement, fillValue) {
        if (!(donutElement instanceof HTMLElement)) return;
        const [fillLayerA, fillLayerB] = ensureAnimatedDonutLayers(donutElement);
        if (!(fillLayerA instanceof HTMLElement) || !(fillLayerB instanceof HTMLElement)) {
            donutElement.style.setProperty('--portfolio-donut-fill', fillValue);
            return;
        }
        const activeLayerKey = donutElement.dataset.activeFillLayer === 'b' ? 'b' : 'a';
        const nextLayerKey = activeLayerKey === 'a' ? 'b' : 'a';
        const nextLayer = nextLayerKey === 'a' ? fillLayerA : fillLayerB;
        nextLayer.style.background = fillValue;
        donutElement.dataset.activeFillLayer = nextLayerKey;
        donutElement.style.setProperty('--portfolio-donut-fill', fillValue);
    }

    function syncAnimatedDonutLogos(logoLayer, logoItems) {
        if (!(logoLayer instanceof HTMLElement)) return;
        const existingLogos = new Map(
            Array.from(logoLayer.querySelectorAll('.portfolio-donut-logo')).map((logo) => [logo.dataset.ticker || '', logo])
        );
        const nextTickers = new Set();
        logoItems.forEach((item) => {
            nextTickers.add(item.ticker);
            let logo = existingLogos.get(item.ticker);
            if (!(logo instanceof HTMLImageElement)) {
                logo = document.createElement('img');
                logo.className = 'portfolio-donut-logo';
                logo.dataset.ticker = item.ticker;
                logo.alt = `${item.ticker} logo`;
                logo.src = item.logoUrl;
                logo.dataset.styleTokenDonutAngle = item.midAngle.toFixed(2);
                logo.style.opacity = '0';
                logoLayer.appendChild(logo);
                window.requestAnimationFrame(() => {
                    logo.style.opacity = '1';
                });
            } else {
                if (logo.src !== item.logoUrl) logo.src = item.logoUrl;
                logo.dataset.styleTokenDonutAngle = item.midAngle.toFixed(2);
            }
            logo.classList.remove('is-exiting');
        });
        existingLogos.forEach((logo, ticker) => {
            if (nextTickers.has(ticker)) return;
            logo.classList.add('is-exiting');
            window.setTimeout(() => {
                if (logo.classList.contains('is-exiting')) logo.remove();
            }, 220);
        });
    }

    function buildMarketStoreLogoUrl(ticker) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        return `/market-store/logos/${encodeURIComponent(normalizedTicker || 'stock')}.png`;
    }

    function resolveInvestmentLogoUrl(profile, ticker) {
        const logoUrl = String(profile?.logo_url || '').trim();
        return logoUrl || buildMarketStoreLogoUrl(ticker);
    }

    function renderInvestmentDummyPortfolioDonut(pointRecord, tickerProfiles) {
        if (!(investmentDummyChart instanceof HTMLElement) || !(investmentDummyLogoLayer instanceof HTMLElement) || !(investmentDummyDonut instanceof HTMLElement)) return;
        const holdingsMarketValues = pointRecord?.holdings_market_values || {};
        const openComponents = Object.entries(holdingsMarketValues)
            .map(([ticker, value]) => ({ ticker: normalizeInvestmentTicker(ticker), marketValue: Number(value) || 0 }))
            .filter((entry) => entry.ticker && entry.marketValue > 1e-9)
            .sort((left, right) => right.marketValue - left.marketValue);
        const openTotalValue = openComponents.reduce((sum, entry) => sum + entry.marketValue, 0);
        const cashValue = Math.max(0, Number(pointRecord?.running_cash) || 0);
        const fallbackTotal = openTotalValue + cashValue;
        const denominator = Math.max(Number(pointRecord?.total_equity) || 0, fallbackTotal, 0);
        if (denominator <= 1e-9) {
            syncAnimatedDonutLogos(investmentDummyLogoLayer, []);
            applyAnimatedDonutFill(investmentDummyDonut, 'conic-gradient(var(--theme-accent-positive) 0deg 360deg)');
            refreshInvestmentDummyDonut();
            return;
        }

        const palette = buildInvestmentDummyPalette(openComponents.length);
        const logoItems = [];
        const fillFragments = [];
        const gapDegrees = 1.2;
        let angle = 0;

        openComponents.forEach((entry, index) => {
            const marketValue = entry.marketValue;
            if (marketValue <= 1e-9) return;
            const sweep = (marketValue / denominator) * 360;
            if (sweep <= 1e-9) return;
            const segmentStart = angle;
            const segmentEnd = Math.min(segmentStart + sweep, 360);
            if ((segmentEnd - segmentStart) > 1e-9) {
                fillFragments.push(`${palette[index] || '#0055cc'} ${segmentStart}deg ${segmentEnd}deg`);
                const midAngle = segmentStart + ((segmentEnd - segmentStart) / 2);
                const ticker = entry.ticker;
                const profile = tickerProfiles?.[ticker] || {};
                const logoUrl = resolveInvestmentLogoUrl(profile, ticker);
                logoItems.push({ ticker, logoUrl, midAngle });
            }
            const hasRemaining = segmentEnd < 360;
            const gapEnd = hasRemaining ? Math.min(segmentEnd + gapDegrees, 360) : segmentEnd;
            if ((gapEnd - segmentEnd) > 1e-9) {
                fillFragments.push(`transparent ${segmentEnd}deg ${gapEnd}deg`);
            }
            angle = gapEnd;
        });

        const cashStart = Math.min(Math.max(angle, 0), 360);
        if ((360 - cashStart) > 1e-9) {
            fillFragments.push(`var(--theme-accent-positive) ${cashStart}deg 360deg`);
        }

        syncAnimatedDonutLogos(investmentDummyLogoLayer, logoItems);
        applyAnimatedDonutFill(investmentDummyDonut, `conic-gradient(${fillFragments.join(', ')})`);
        refreshInvestmentDummyDonut();
    }

    function syncInvestmentDummyDonutFromInteraction() {
        if (!Array.isArray(investmentChartPointsCache) || !investmentChartPointsCache.length) return;
        let pointRecord = null;
        if (Number.isFinite(activeChartTooltipPointIndex) && activeChartTooltipPointIndex >= 0) {
            pointRecord = investmentChartPointsCache[activeChartTooltipPointIndex] || null;
        }
        if (!pointRecord && Number.isFinite(activeHoldingsHoverLedgerNo) && activeHoldingsHoverLedgerNo > 0) {
            const hoverIndex = investmentChartPointIndexByLedgerNo.get(activeHoldingsHoverLedgerNo);
            if (Number.isFinite(hoverIndex) && hoverIndex >= 0) {
                pointRecord = investmentChartPointsCache[hoverIndex] || null;
            }
        }
        if (!pointRecord) {
            pointRecord = investmentLatestChartPoint || investmentChartPointsCache[investmentChartPointsCache.length - 1] || null;
        }
        if (!pointRecord) return;
        renderInvestmentDummyPortfolioDonut(pointRecord, investmentDummyTickerProfiles);
    }

    function refreshPortfolioDonutOrbits(rootElement) {
        if (!(rootElement instanceof HTMLElement)) return;
        rootElement.querySelectorAll('.style-token-portfolio-donut-orbit').forEach((orbitElement) => {
            if (!(orbitElement instanceof HTMLElement)) return;
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
            orbitElement.querySelectorAll('.portfolio-donut-logo[data-style-token-donut-angle]').forEach((logoElement) => {
                if (!(logoElement instanceof HTMLImageElement)) return;
                const angle = Number.parseFloat(logoElement.dataset.styleTokenDonutAngle || '');
                if (!Number.isFinite(angle)) return;
                const radians = ((angle - 90) * Math.PI) / 180;
                const x = centerX + (Math.cos(radians) * orbitRadius);
                const y = centerY + (Math.sin(radians) * orbitRadius);
                logoElement.style.left = `${x.toFixed(2)}px`;
                logoElement.style.top = `${y.toFixed(2)}px`;
            });
        });
    }

    function refreshInvestmentDummyDonut() {
        refreshPortfolioDonutOrbits(investmentDummyChart);
    }

    function initInvestmentDummyDonut() {
        if (!(investmentDummyChart instanceof HTMLElement)) return;
        refreshInvestmentDummyDonut();
        refreshPortfolioDonutOrbits(investmentStockDetailsPanel);
        if (window.ResizeObserver) {
            const donutResizeObserver = new ResizeObserver(() => {
                refreshInvestmentDummyDonut();
                refreshPortfolioDonutOrbits(investmentStockDetailsPanel);
            });
            donutResizeObserver.observe(investmentDummyChart);
            const orbit = investmentDummyChart.querySelector('.style-token-portfolio-donut-orbit');
            if (orbit instanceof HTMLElement) {
                donutResizeObserver.observe(orbit);
            }
            if (investmentStockDetailsPanel instanceof HTMLElement) {
                donutResizeObserver.observe(investmentStockDetailsPanel);
            }
        } else {
            window.addEventListener('resize', () => {
                refreshInvestmentDummyDonut();
                refreshPortfolioDonutOrbits(investmentStockDetailsPanel);
            }, {passive: true});
        }
    }

    function setImportFeedback(message, variant = 'success') {
        if (!importFeedback) return;
        const resolvedVariant = ['error', 'warning', 'success'].includes(variant) ? variant : 'success';
        const isError = resolvedVariant === 'error';
        const isWarning = resolvedVariant === 'warning';
        importFeedback.hidden = true;
        importFeedback.style.animation = 'none';
        void importFeedback.offsetWidth;
        importFeedback.style.animation = '';
        importFeedback.removeAttribute('hidden');
        if (importFeedbackMessage) {
            importFeedbackMessage.textContent = String(message || '').trim()
                || (isError ? 'Import failed.' : (isWarning ? 'Investment data loaded with warnings.' : 'Import complete.'));
        } else {
            importFeedback.textContent = message;
        }
        if (importFeedbackIcon) {
            importFeedbackIcon.classList.toggle('investment-import-feedback-banner-icon-error', isError || isWarning);
            importFeedbackIcon.classList.toggle('investment-import-feedback-banner-icon-success', !isError && !isWarning);
            importFeedbackIcon.classList.toggle('icon-modal-dialog-banner-default', isError || isWarning);
        }
    }

    function clearImportFeedback() {
        if (!importFeedback) return;
        importFeedback.setAttribute('hidden', '');
        if (importFeedbackMessage) {
            importFeedbackMessage.textContent = '';
        } else {
            importFeedback.textContent = '';
        }
        if (importFeedbackIcon) {
            importFeedbackIcon.classList.remove('investment-import-feedback-banner-icon-error');
            importFeedbackIcon.classList.remove('investment-import-feedback-banner-icon-success');
            importFeedbackIcon.classList.add('icon-modal-dialog-banner-default');
        }
    }

    function isLikelyCsvFile(file) {
        return Boolean(file && /\.csv$/i.test(file.name || ''));
    }

    function isLikelyTransactionHistoryFile(file) {
        if (!isLikelyCsvFile(file)) return false;
        const upperName = String(file.name || '').toUpperCase();
        return upperName.includes('TRANSACTIONS');
    }

    function isLikelyPositionsFile(file) {
        if (!isLikelyCsvFile(file)) return false;
        const upperName = String(file.name || '').toUpperCase();
        return !upperName.includes('TRANSACTIONS');
    }

    function setImportStatusIcon(icon, visible) {
        if (!icon) return;
        icon.classList.toggle('is-visible', Boolean(visible));
    }

    function setInvestmentExportButtonVisibility(isVisible) {
        investmentHasExportableTransactions = Boolean(isVisible);
        if (!exportTransactionsButton) return;
        exportTransactionsButton.hidden = !(investmentHasExportableTransactions && investmentChartReady);
    }

    function setInvestmentChartReady(isReady, canvas = null) {
        investmentChartReady = Boolean(isReady);
        if (canvas instanceof HTMLCanvasElement) {
            canvas.dataset.investmentChartReady = investmentChartReady ? '1' : '0';
        }
        setInvestmentExportButtonVisibility(investmentHasExportableTransactions);
    }

    function normalizeInvestmentTicker(ticker) {
        return String(ticker || '').trim().toUpperCase();
    }

    function syncHoldingsChartHoverState(ticker, ledgerNo) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        const normalizedLedgerNo = Number.isFinite(Number(ledgerNo)) && Number(ledgerNo) > 0
            ? Number(ledgerNo)
            : 0;
        const shouldUpdate = normalizedTicker !== activeHoldingsHoverTicker || normalizedLedgerNo !== activeHoldingsHoverLedgerNo;
        activeHoldingsHoverTicker = normalizedTicker;
        activeHoldingsHoverLedgerNo = normalizedLedgerNo;
        syncInvestmentDummyDonutFromInteraction();
        if (!shouldUpdate || !investmentEquityChartInstance) return;
        investmentEquityChartInstance.update('none');
    }

    function easeOutCubic(t) {
        const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
        const inverse = 1 - clamped;
        return 1 - (inverse * inverse * inverse);
    }

    function escapeMarkdownTableCell(value) {
        return String(value ?? '')
            .replace(/\|/g, '\\|')
            .replace(/\r?\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function extractMarkdownTable(tableElement) {
        if (!tableElement) return '';
        const rows = Array.from(tableElement.querySelectorAll('tr'));
        if (!rows.length) return '';

        const matrix = rows
            .map((row) => Array.from(row.children).map((cell) => escapeMarkdownTableCell(cell.textContent)))
            .filter((row) => row.some((cell) => cell.length > 0));
        if (!matrix.length) return '';

        const header = matrix[0];
        const body = matrix.slice(1);
        const alignment = header.map(() => '---');
        const tableLines = [
            `| ${header.join(' | ')} |`,
            `| ${alignment.join(' | ')} |`,
            ...body.map((row) => {
                const paddedRow = [...row];
                while (paddedRow.length < header.length) {
                    paddedRow.push('');
                }
                return `| ${paddedRow.join(' | ')} |`;
            }),
        ];
        return tableLines.join('\n');
    }

    function formatInvestmentExportDate(rawDate) {
        const match = String(rawDate || '').match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
        if (!match) return String(rawDate || '').trim();
        const monthAbbreviations = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const year = Number(match[1]);
        const monthIndex = Number(match[2]) - 1;
        const day = Number(match[3]);
        return `${day} ${monthAbbreviations[monthIndex] || ''} ${year}`.trim();
    }

    function buildExportDateRange(transactions) {
        const rawDates = Array.isArray(transactions)
            ? transactions
                .map((txn) => String(txn?.date || '').match(/^(\d{4})-(\d{2})-(\d{2})/)?.slice(1).join('-') || '')
                .filter(Boolean)
            : [];
        if (!rawDates.length) {
            const today = new Date();
            const year = `${today.getFullYear()}`;
            const month = `${today.getMonth() + 1}`.padStart(2, '0');
            const day = `${today.getDate()}`.padStart(2, '0');
            const fallback = `${year}-${month}-${day}`;
            return { start: fallback, end: fallback };
        }
        const sortedDates = [...rawDates].sort();
        return { start: sortedDates[0], end: sortedDates[sortedDates.length - 1] };
    }

    function buildInvestmentMetricsMarkdown(transactions) {
        const fundingMetrics = getUsdFundingMetrics(Array.isArray(transactions) ? transactions : []);
        const metrics = [
            ['Direct deposits', fundingMetrics.directUsdDeposits],
            ['Net USD converted', fundingMetrics.netUsdConverted],
            ['FX funding loss', fundingMetrics.fxFundingLoss],
            ['Final investable USD', fundingMetrics.finalInvestableUsd],
        ];
        return metrics
            .map(([label, value]) => `**${label}:** ${formatAmount(value)}`)
            .join('\n');
    }

    function guessInvestmentExportDescription(transactions, holdingsTableMarkdown) {
        const tickerSet = new Set(
            (Array.isArray(transactions) ? transactions : [])
                .map((txn) => String(txn?.ticker || '').trim().toUpperCase())
                .filter(Boolean)
        );
        if (tickerSet.size === 1) {
            const [ticker] = Array.from(tickerSet);
            return `${ticker} Investment Holdings and Transaction History`;
        }
        if (holdingsTableMarkdown.includes('Money market')) {
            return 'Investment Holdings and Cash Transaction History';
        }
        return 'Investment Holdings and Transaction History';
    }

    function downloadMarkdownFile(filename, content) {
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        const objectUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => {
            window.URL.revokeObjectURL(objectUrl);
        }, 0);
    }

    function buildInvestmentMarkdownExport() {
        const holdingsHeaderTable = document.querySelector('#investment_holdings_panel .investment-holdings-table[aria-hidden="true"]');
        const holdingsBodyTable = document.querySelector('#investment_holdings_panel .investment-holdings-table-scroll table');
        const historyHeaderTable = document.querySelector('#history_table_wrap table[aria-hidden="true"]');
        const historyBodyTable = document.querySelector('#history_table_wrap .investment-history-table-scroll table');
        if (!holdingsHeaderTable || !holdingsBodyTable || !historyHeaderTable || !historyBodyTable) {
            return null;
        }

        const holdingsHeaderRow = holdingsHeaderTable.querySelector('tr');
        const holdingsBodyRows = Array.from(holdingsBodyTable.querySelectorAll('tbody tr'));
        const holdingsTable = document.createElement('table');
        if (holdingsHeaderRow) {
            const thead = document.createElement('thead');
            thead.appendChild(holdingsHeaderRow.cloneNode(true));
            holdingsTable.appendChild(thead);
        }
        const holdingsTbody = document.createElement('tbody');
        holdingsBodyRows.forEach((row) => holdingsTbody.appendChild(row.cloneNode(true)));
        holdingsTable.appendChild(holdingsTbody);

        const historyHeaderRow = historyHeaderTable.querySelector('tr');
        const historyBodyRows = Array.from(historyBodyTable.querySelectorAll('tbody tr'));
        const historyTable = document.createElement('table');
        if (historyHeaderRow) {
            const thead = document.createElement('thead');
            thead.appendChild(historyHeaderRow.cloneNode(true));
            historyTable.appendChild(thead);
        }
        const historyTbody = document.createElement('tbody');
        historyBodyRows.forEach((row) => historyTbody.appendChild(row.cloneNode(true)));
        historyTable.appendChild(historyTbody);

        const holdingsMarkdown = extractMarkdownTable(holdingsTable);
        const historyMarkdown = extractMarkdownTable(historyTable);
        if (!holdingsMarkdown || !historyMarkdown) {
            return null;
        }

        const transactions = window.ANTIGRAVITY_INVESTMENT_DATA?.transactions || [];
        const dateRange = buildExportDateRange(transactions);
        const title = guessInvestmentExportDescription(transactions, holdingsMarkdown);
        const metricsMarkdown = buildInvestmentMetricsMarkdown(transactions);
        const formattedRange = `${formatInvestmentExportDate(dateRange.start)} - ${formatInvestmentExportDate(dateRange.end)}`;
        const markdown = [
            `# ${title}`,
            '',
            `**Range:** ${formattedRange}`,
            '',
            '## Holdings',
            '',
            holdingsMarkdown,
            '',
            '## Metrics',
            '',
            metricsMarkdown,
            '',
            '## Transaction history',
            '',
            historyMarkdown,
            '',
        ].join('\n');

        return {
            filename: `${title} ${dateRange.start} - ${dateRange.end}.md`,
            markdown,
        };
    }

    function bindInvestmentExportButton() {
        if (!exportTransactionsButton || exportTransactionsButton.dataset.bound === '1') return;
        exportTransactionsButton.dataset.bound = '1';
        exportTransactionsButton.addEventListener('click', () => {
            const exportPayload = buildInvestmentMarkdownExport();
            if (!exportPayload) return;
            downloadMarkdownFile(exportPayload.filename, exportPayload.markdown);
        });
    }

    function bindHoldingsLogoFallbacks(container) {
        if (!container) return;
        container.querySelectorAll('[data-investment-logo-image]').forEach((logo) => {
            if (logo.dataset.logoFallbackBound === '1') return;
            logo.dataset.logoFallbackBound = '1';
            logo.addEventListener('error', () => {
                logo.remove();
            }, { once: true });
        });
    }

    function getInvestmentHistoryScrollContainer() {
        return document.querySelector('.investment-history-table-scroll');
    }

    function getInvestmentHistoryRowsByLedgerNos(ledgerNos) {
        return Array.from(new Set((Array.isArray(ledgerNos) ? ledgerNos : [])
            .map((ledgerNo) => Number(ledgerNo))
            .filter((ledgerNo) => Number.isFinite(ledgerNo) && ledgerNo > 0)))
            .map((ledgerNo) => document.getElementById(`investment_history_row_${ledgerNo}`))
            .filter(Boolean);
    }

    function getInvestmentStockDetailsScrollContainer() {
        return document.querySelector('.investment-stock-details-table-scroll');
    }

    function getInvestmentStockDetailRowsByLedgerNos(ledgerNos) {
        return Array.from(new Set((Array.isArray(ledgerNos) ? ledgerNos : [])
            .map((ledgerNo) => Number(ledgerNo))
            .filter((ledgerNo) => Number.isFinite(ledgerNo) && ledgerNo > 0)))
            .map((ledgerNo) => document.querySelector(`tr[data-investment-stock-detail-ledger="${CSS.escape(String(ledgerNo))}"]`))
            .filter(Boolean);
    }

    function clearInvestmentHistoryHighlights() {
        activeInvestmentHistoryRowIds.forEach((rowId) => {
            const row = document.getElementById(rowId);
            if (!row) return;
            row.classList.remove('is-metric-hover-active');
            row.classList.remove('is-metric-hover-target');
        });
        activeInvestmentHistoryRowIds = [];
    }

    function clearInvestmentStockDetailHighlights() {
        activeInvestmentStockDetailRowIds.forEach((rowId) => {
            const row = document.getElementById(rowId);
            if (!row) return;
            row.classList.remove('is-metric-hover-active');
            row.classList.remove('is-metric-hover-target');
        });
        activeInvestmentStockDetailRowIds = [];
    }

    // Code version: v0.2.0.0
    function scrollInvestmentHistoryRowsIntoView(rows, behavior = 'smooth') {
        const normalizedRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
        if (!normalizedRows.length) return;
        const scrollContainer = getInvestmentHistoryScrollContainer();
        if (scrollContainer) {
            const rowTop = Math.min(...normalizedRows.map((row) => row.offsetTop - scrollContainer.offsetTop));
            const rowBottom = Math.max(...normalizedRows.map((row) => row.offsetTop - scrollContainer.offsetTop + row.clientHeight));
            const groupHeight = Math.max(0, rowBottom - rowTop);
            const groupCenter = rowTop + (groupHeight / 2);
            const targetTop = groupCenter - (scrollContainer.clientHeight / 2);
            scrollContainer.scrollTo({ top: Math.max(0, targetTop), behavior });
            return;
        }
        const midpointRow = normalizedRows[Math.floor(normalizedRows.length / 2)];
        midpointRow.scrollIntoView({ block: 'center', behavior });
    }

    function scrollInvestmentStockDetailRowIntoView(row, behavior = 'smooth') {
        if (!row) return;
        const scrollContainer = getInvestmentStockDetailsScrollContainer();
        if (scrollContainer) {
            const rowOffset = row.offsetTop - scrollContainer.offsetTop;
            const targetTop = rowOffset - (scrollContainer.clientHeight / 2) + (row.clientHeight / 2);
            scrollContainer.scrollTo({ top: Math.max(0, targetTop), behavior });
            return;
        }
        row.scrollIntoView({ block: 'center', behavior });
    }

    function activateInvestmentHistoryRows(ledgerNos, { behavior = 'smooth', scroll = true } = {}) {
        const rows = getInvestmentHistoryRowsByLedgerNos(ledgerNos);
        if (!rows.length) return;
        clearInvestmentHistoryHighlights();
        rows.forEach((row) => {
            row.classList.remove('is-metric-hover-target');
            void row.offsetWidth;
            row.classList.add('is-metric-hover-target');
            row.classList.add('is-metric-hover-active');
        });
        activeInvestmentHistoryRowIds = rows.map((row) => row.id);
        if (scroll) {
            scrollInvestmentHistoryRowsIntoView(rows, behavior);
        }
    }

    function activateInvestmentStockDetailRows(ledgerNos, { behavior = 'smooth', scroll = true } = {}) {
        const rows = getInvestmentStockDetailRowsByLedgerNos(ledgerNos);
        if (!rows.length) {
            clearInvestmentStockDetailHighlights();
            return;
        }
        clearInvestmentStockDetailHighlights();
        rows.forEach((row, index) => {
            if (!row.id) {
                row.id = `investment_stock_detail_row_${ledgerNos[index]}`;
            }
            row.classList.remove('is-metric-hover-target');
            void row.offsetWidth;
            row.classList.add('is-metric-hover-target');
            row.classList.add('is-metric-hover-active');
        });
        activeInvestmentStockDetailRowIds = rows.map((row) => row.id).filter(Boolean);
        if (scroll) {
            scrollInvestmentStockDetailRowIntoView(rows[0], behavior);
        }
    }

    function scheduleInvestmentStockDetailRowActivation(ledgerNos, { behavior = 'auto', scroll = true } = {}) {
        window.requestAnimationFrame(() => {
            activateInvestmentStockDetailRows(ledgerNos, { behavior, scroll });
        });
    }

    function getLatestHistoryRowForTicker(ticker) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (!normalizedTicker) return null;
        return document.querySelector(`tr[data-investment-history-ticker="${CSS.escape(normalizedTicker)}"]`);
    }

    function getHistoryRowsForLedgerDate(rawDate) {
        const normalizedDate = String(rawDate || '').match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || '';
        if (!normalizedDate) return [];
        return Array.from(document.querySelectorAll(`tr[data-investment-history-date="${CSS.escape(normalizedDate)}"]`));
    }

    function renderFundingMetricCards(fundingMetrics) {
        return FUNDING_METRIC_DEFINITIONS.map((definition) => `
            <div class="trade-metric-card">
                <span class="trade-metric-label">${definition.label}</span>
                ${renderMetricValueWithTooltip({
                    key: definition.key,
                    value: formatAmount(fundingMetrics?.[definition.valueKey]),
                    summary: definition.summary,
                    rows: fundingMetrics?.[definition.rowsKey],
                })}
            </div>
        `).join('');
    }

    function resetInvestmentDashboard() {
        const holdingsPanel = document.getElementById('investment_holdings_panel');
        const metricsPanel = document.getElementById('investment_metrics_panel');
        const stockDetailsPanel = document.getElementById('investment_stock_details_panel');
        const chartContainer = document.getElementById('investment_equity_chart');

        selectedInvestmentStockTicker = '';
        investmentProcessedTransactionsCache = [];
        investmentTickerSummariesCache = [];
        clearInvestmentStockDetailHighlights();
        if (holdingsPanel) {
            holdingsPanel.innerHTML = renderHoldingsTable([], {}, 0);
        }
        if (metricsPanel) {
            metricsPanel.innerHTML = renderFundingMetricCards(getUsdFundingMetrics([]));
            bindInvestmentMetricTooltipInteractions(metricsPanel);
        }
        if (stockDetailsPanel) {
            stockDetailsPanel.innerHTML = `
                <div class="investment-stock-details-empty-shell">
                    <p class="investment-holdings-empty">Open Holdings or import transactions, then pick a ticker to inspect its stock details.</p>
                </div>
            `;
        }
        if (chartContainer) {
            chartContainer.innerHTML = '';
        }
    }

    function syncImportValidationState() {
        const transactionFile = transactionsCsvInput?.files?.[0];
        const positionsFile = positionsCsvInput?.files?.[0];
        const transactionReady = isLikelyTransactionHistoryFile(transactionFile);
        const positionsReady = isLikelyPositionsFile(positionsFile);
        const importReady = transactionReady && positionsReady;

        setImportStatusIcon(transactionsCsvStatus, transactionReady);
        setImportStatusIcon(positionsCsvStatus, positionsReady);

        const submitButton = investmentForm?.querySelector('button[type="submit"]');
        syncActionButtonState(submitButton, {
            disabled: !importReady,
            pending: investmentImportInFlight,
        });
    }

    function openInvestmentImportForm() {
        if (!toggleBtn || !formContainer || !toggleIcon) return;
        if (investmentFormHideTimer) {
            window.clearTimeout(investmentFormHideTimer);
            investmentFormHideTimer = null;
        }
        clearImportFeedback();
        formContainer.style.display = 'block';
        syncInvestmentFormLayout();
        setTimeout(() => {
            formContainer.style.opacity = '1';
            formContainer.style.transform = 'scale(1)';
        }, 50);
        toggleIcon.classList.add('is-minus');
        toggleBtn.setAttribute('aria-label', 'Hide IBKR CSV import form');
    }

    function closeInvestmentImportForm() {
        if (!toggleBtn || !formContainer || !toggleIcon) return;
        if (investmentFormHideTimer) {
            window.clearTimeout(investmentFormHideTimer);
            investmentFormHideTimer = null;
        }
        formContainer.style.opacity = '0';
        formContainer.style.transform = 'scale(0.98)';
        investmentFormHideTimer = window.setTimeout(() => {
            formContainer.style.display = 'none';
            syncInvestmentFormLayout();
            investmentFormHideTimer = null;
        }, 400);
        toggleIcon.classList.remove('is-minus');
        toggleBtn.setAttribute('aria-label', 'Import IBKR CSV files');
    }

    function buildInvestmentRequestOptions(overrides = {}) {
        const headers = {
            'Cache-Control': 'no-cache',
            ...(overrides.headers || {}),
        };
        return {
            credentials: 'same-origin',
            cache: 'no-store',
            ...overrides,
            headers,
        };
    }

    async function fetchInvestmentData() {
        const response = await fetch('/api/investment/transactions', buildInvestmentRequestOptions());
        const data = await response.json();
        if (!response.ok || data.success === false) {
            throw new Error(data.error || `Failed to load investment data: ${response.status}`);
        }
        window.ANTIGRAVITY_INVESTMENT_DATA = data;
        const valuationStatus = await renderTransactionTable(data.transactions || []);
        scheduleInvestmentSegmentedPillUpdate();
        return { data, valuationStatus };
    }

    initInvestmentViewTabs();
    initInvestmentDummyDonut();
    bindInvestmentExportButton();
    syncImportValidationState();
    [transactionsCsvInput, positionsCsvInput].forEach((input) => {
        if (input) {
            input.addEventListener('change', () => {
                clearImportFeedback();
                syncImportValidationState();
            });
        }
    });

    function syncInvestmentFormLayout() {
        if (!formContainer || !historyTable || !parentSection) return;
        historyTable.style.transform = 'translateY(0)';
        parentSection.style.paddingBottom = '20px';
    }

    // Toggle form visibility
    const parentSection = formContainer.closest('.chart-surface');
    const toggleIcon = document.getElementById('toggle_form_icon');
    if (toggleBtn && formContainer && parentSection && toggleIcon) {
        toggleBtn.addEventListener('click', () => {
            const isVisible = formContainer.style.display === 'block';
            if (isVisible) {
                closeInvestmentImportForm();
            } else {
                openInvestmentImportForm();
            }
        });

        const handleInvestmentLayoutChange = () => {
            syncInvestmentFormLayout();
        };

        window.addEventListener('resize', handleInvestmentLayoutChange);

        if (window.ResizeObserver) {
            const investmentFormResizeObserver = new ResizeObserver(handleInvestmentLayoutChange);
            investmentFormResizeObserver.observe(formContainer);
        }
    }

    // Handle form submission
    if (investmentForm) {
        investmentForm.addEventListener('submit', (e) => {
            e.preventDefault();
            clearImportFeedback();
            const transactionsCsv = document.getElementById('transactions_csv');
            const positionsCsv = document.getElementById('positions_csv');
            const transactionsFile = transactionsCsv?.files?.[0];
            const positionsFile = positionsCsv?.files?.[0];
            if (!transactionsFile || !positionsFile) {
                setImportFeedback('Please choose both IBKR CSV files before importing.', 'error');
                return;
            }
            if (!isLikelyTransactionHistoryFile(transactionsFile) || !isLikelyPositionsFile(positionsFile)) {
                setImportFeedback('Please make sure the first file is your Transaction History CSV and the second file is your Realized Summary CSV.', 'error');
                return;
            }

            const formData = new FormData();
            formData.append('transactions_csv', transactionsFile);
            formData.append('positions_csv', positionsFile);

            const submitButton = investmentForm.querySelector('button[type="submit"]');
            investmentImportInFlight = true;
            syncImportValidationState();
            fetch('/api/investment/transactions', {
                method: 'POST',
                body: formData,
            })
            .then(response => response.json())
            .then(async result => {
                if (result.success) {
                    const refreshNotice = Array.isArray(result.freshness_refresh_failures) && result.freshness_refresh_failures.length
                        ? ` Some open positions could not be refreshed yet: ${result.freshness_refresh_failures.join(', ')}.`
                        : '';
                    const { valuationStatus } = await fetchInvestmentData();
                    const valuationNotice = valuationStatus?.isDegraded ? ` ${valuationStatus.message}` : '';
                    const feedbackVariant = valuationStatus?.isDegraded ? 'warning' : 'success';
                    setImportFeedback(`${result.message || 'Import complete.'}${refreshNotice}${valuationNotice}`, feedbackVariant);
                    closeInvestmentImportForm();
                } else {
                    setImportFeedback(result.error || 'Import failed.', 'error');
                }
            })
            .catch(err => {
                setImportFeedback(`Network error: ${err.message}`, 'error');
            })
            .finally(() => {
                investmentImportInFlight = false;
                syncImportValidationState();
            });
        });
    }

    // Load and render transactions
    fetchInvestmentData()
        .then(({ valuationStatus }) => {
            if (valuationStatus?.isDegraded) {
                setImportFeedback(valuationStatus.message, 'warning');
            }
        })
        .catch(err => {
            console.error('Failed to load transactions:', err);
            setImportFeedback(`Failed to load investment data: ${err.message}`, 'error');
        });

    function getNormalizedTransactionType(txn) {
        return String(txn?.type || '').replace(/\s+/g, '_').toLowerCase();
    }

    function getTransactionQuantity(txn) {
        const quantity = txn.quantity ?? txn.quantity_abs ?? txn.normalized?.position_quantity;
        return quantity === undefined || quantity === null ? null : Number(quantity);
    }

    function getTransactionAmount(txn) {
        if (txn.normalized?.net_amount !== undefined && txn.normalized?.net_amount !== null) {
            return Number(txn.normalized.net_amount);
        }
        if (txn.amount !== undefined && txn.amount !== null) {
            return Number(txn.amount);
        }
        if (txn.cash !== undefined && txn.cash !== null) {
            return Number(txn.cash);
        }
        return 0;
    }

    function getTransactionCommission(txn) {
        const commission = txn?.normalized?.commission ?? txn?.commission ?? 0;
        const numericCommission = Number(commission);
        return Number.isFinite(numericCommission) ? numericCommission : 0;
    }

    function getInvestmentStartingCash() {
        const rawValue = window.ANTIGRAVITY_INVESTMENT_DATA?.starting_cash;
        if (rawValue === undefined || rawValue === null || rawValue === '') {
            return 0;
        }
        const numericValue = Number(rawValue);
        return Number.isFinite(numericValue) ? numericValue : 0;
    }

    function getTransactionEconomicAmount(txn) {
        const amount = getTransactionAmount(txn);
        if (Math.abs(amount) > 1e-9) return amount;

        const normalizedType = getNormalizedTransactionType(txn);
        const quantity = getTransactionQuantity(txn);
        const price = getTransactionPrice(txn);
        if (quantity === null || price === null || Number.isNaN(quantity) || Number.isNaN(price)) {
            return amount;
        }

        if (['buy', 'sell', 'grant'].includes(normalizedType)) {
            return quantity * price;
        }

        return amount;
    }

    function getTransactionPrice(txn) {
        if (txn.normalized?.unit_price !== undefined && txn.normalized?.unit_price !== null) {
            return Number(txn.normalized.unit_price);
        }
        if (txn.price !== undefined && txn.price !== null) {
            return Number(txn.price);
        }
        return null;
    }

    function formatTransactionDateDisplay(txn) {
        let formattedTime = txn?.date ? String(txn.date).replace(/-/g, '/') : '';
        if (formattedTime.includes(' ') && formattedTime.endsWith('20:00:00')) {
            formattedTime = formattedTime.split(' ')[0];
        }
        return formattedTime;
    }

    function formatAmountWithCurrency(value, currency) {
        if (value === undefined || value === null || Number.isNaN(Number(value))) return '--';
        const numericValue = Number(value);
        const sign = numericValue < 0 ? '-' : '';
        const absDisplay = formatAmount(Math.abs(numericValue));
        const normalizedCurrency = String(currency || '').trim().toUpperCase();
        if (normalizedCurrency === 'USD') {
            return `${sign}$${absDisplay}`;
        }
        if (normalizedCurrency) {
            return `${sign}${normalizedCurrency} ${absDisplay}`;
        }
        return `${sign}${absDisplay}`;
    }

    function formatTransactionCommissionDisplay(txn, { includeCurrency = false } = {}) {
        const normalizedType = getNormalizedTransactionType(txn);
        const commission = getTransactionCommission(txn);
        if ((!commission || Math.abs(commission) < 1e-9) && NO_COMMISSION_TRANSACTION_TYPES.has(normalizedType)) {
            return '-';
        }
        const absoluteCommission = Math.abs(commission);
        if (!includeCurrency) {
            return formatAmount(absoluteCommission);
        }
        return formatAmountWithCurrency(absoluteCommission, formatTransactionCurrency(txn));
    }

    function formatTransactionCurrency(txn) {
        const normalizedType = getNormalizedTransactionType(txn);
        if (normalizedType === 'forex_trade_component') {
            const forexPair = String(txn?.ticker || '').trim();
            const [baseCurrency] = forexPair.split('.');
            return baseCurrency || '';
        }

        const explicitCurrency = String(txn?.currency || '').trim();
        if (explicitCurrency) return explicitCurrency;

        return '';
    }

    function formatForexTradeComponentDescription(txn) {
        const forexPair = String(txn?.ticker || '').trim();
        const [baseCurrency, quoteCurrency] = forexPair.split('.');
        const quantity = getTransactionQuantity(txn);
        const rate = getTransactionPrice(txn);

        if (!baseCurrency || !quoteCurrency || !Number.isFinite(quantity) || !Number.isFinite(rate)) {
            return txn.description || '--';
        }

        const quantityText = Number.isInteger(quantity) ? `${quantity}` : String(txn.quantity_raw ?? txn.quantity_abs ?? txn.normalized?.display_quantity ?? quantity);
        const rateText = String(txn.price_raw ?? txn.normalized?.unit_price ?? rate);
        return `Bought ${quantityText} ${baseCurrency} @ ${baseCurrency}.${quoteCurrency} ${rateText}`;
    }

    function formatTransactionDescription(txn) {
        let description;
        let qty = txn.quantity ?? txn.quantity_abs ?? txn.normalized?.display_quantity;
        const price = txn.normalized?.unit_price ?? txn.price;
        const normalizedTypeDesc = getNormalizedTransactionType(txn);

        if (normalizedTypeDesc === 'forex_trade_component') {
            return formatForexTradeComponentDescription(txn);
        }

        if (txn.ticker && qty) {
            const cleanQty = Number.isInteger(Number(qty)) ? String(parseInt(qty, 10)) : qty;
            if (price && ['buy', 'sell', 'grant'].includes(normalizedTypeDesc)) {
                const cleanPrice = Number(price).toFixed(2);
                description = `${txn.ticker} @ ${cleanPrice} × ${cleanQty}`;
            } else {
                description = `${txn.ticker}@${cleanQty}`;
            }
        } else if (normalizedTypeDesc === 'deposit') {
            description = '* Equivalent';
        } else if (normalizedTypeDesc === 'withdrawal') {
            description = '';
        } else {
            description = txn.description || '--';
        }

        return description;
    }

    function formatHoldingsMoney(value, {dashWhenZero = false} = {}) {
        if (value === null || value === undefined || Number.isNaN(value)) return '-';
        if (dashWhenZero && Math.abs(value) < 1e-9) return '-';
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
    }

    function formatHoldingsPercent(value) {
        if (value === null || value === undefined || Number.isNaN(value)) return '-';
        return `${new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value)}%`;
    }

    function formatHoldingsUsd(value, {dashWhenNull = false} = {}) {
        if (value === null || value === undefined || Number.isNaN(value)) {
            return dashWhenNull ? '-' : '$0.00';
        }
        const sign = value < 0 ? '-' : '';
        return `${sign}$${formatHoldingsMoney(Math.abs(value))}`;
    }

    function formatHoldingsPosition(quantity) {
        if (quantity === null || quantity === undefined || Number.isNaN(quantity) || Math.abs(quantity) < 1e-9) {
            return '-';
        }
        const hasFraction = Math.abs(quantity - Math.round(quantity)) > 1e-9;
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: hasFraction ? 2 : 0,
            maximumFractionDigits: hasFraction ? 4 : 0,
        }).format(quantity);
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function shouldTrackHoldingTicker(txn) {
        const ticker = String(txn?.ticker || '').trim();
        if (!ticker) return false;
        const normalizedType = getNormalizedTransactionType(txn);
        return !['forex_trade', 'forex_trade_component', 'fx_translation_pnl'].includes(normalizedType);
    }

    // Code version: v0.2.0.1
    function isFlatPosition(value) {
        return !Number.isFinite(value) || Math.abs(value) < 1e-9;
    }

    function createPositionState(ticker) {
        return {
            ticker,
            shares: 0,
            totalCost: 0,
            realizedPnl: 0,
        };
    }

    function getTransactionEffectiveUnitPrice(txn, quantityOverride = null) {
        const quantity = quantityOverride ?? getTransactionQuantity(txn);
        if (quantity !== null && Number.isFinite(quantity) && quantity > 0) {
            if (txn?.normalized?.net_amount !== undefined && txn?.normalized?.net_amount !== null) {
                const normalizedAmount = Number(txn.normalized.net_amount);
                if (Number.isFinite(normalizedAmount) && Math.abs(normalizedAmount) > 1e-9) {
                    return Math.abs(normalizedAmount) / quantity;
                }
            }
            const normalizedType = getNormalizedTransactionType(txn);
            const economicAmount = getTransactionEconomicAmount(txn);
            const commission = Math.abs(getTransactionCommission(txn));
            if (Number.isFinite(economicAmount) && Math.abs(economicAmount) > 1e-9) {
                if (normalizedType === 'buy') {
                    return (Math.abs(economicAmount) + commission) / quantity;
                }
                if (normalizedType === 'sell') {
                    return Math.max(0, Math.abs(economicAmount) - commission) / quantity;
                }
                return Math.abs(economicAmount) / quantity;
            }
        }
        const price = getTransactionPrice(txn);
        return Number.isFinite(price) ? price : 0;
    }

    function resetPositionState(state) {
        state.shares = 0;
        state.totalCost = 0;
    }

    function openPositionLots(state, side, quantity, unitPrice) {
        if (!Number.isFinite(quantity) || quantity <= 0) return;
        const signedQuantity = side === 'short' ? -quantity : quantity;
        state.shares += signedQuantity;
        state.totalCost += unitPrice * quantity;
    }

    function closePositionLots(state, quantity, unitPrice) {
        if (!Number.isFinite(quantity) || quantity <= 0 || isFlatPosition(state.shares)) return 0;

        const averagePrice = state.totalCost / Math.abs(state.shares);
        const isLongPosition = state.shares > 0;
        let realizedDelta = 0;

        if (isLongPosition) {
            realizedDelta = (unitPrice - averagePrice) * quantity;
            state.shares -= quantity;
        } else {
            realizedDelta = (averagePrice - unitPrice) * quantity;
            state.shares += quantity;
        }

        state.realizedPnl += realizedDelta;
        state.totalCost -= averagePrice * quantity;

        if (isFlatPosition(state.shares) || isFlatPosition(state.totalCost)) {
            resetPositionState(state);
        }
        return realizedDelta;
    }

    function applyDirectionalTrade(state, side, quantity, unitPrice) {
        if (!Number.isFinite(quantity) || quantity <= 0) return 0;

        if (isFlatPosition(state.shares)) {
            openPositionLots(state, side, quantity, unitPrice);
            return 0;
        }

        const currentSide = state.shares > 0 ? 'long' : 'short';
        if (currentSide === side) {
            openPositionLots(state, side, quantity, unitPrice);
            return 0;
        }

        const closingQuantity = Math.min(Math.abs(state.shares), quantity);
        const realizedDelta = closePositionLots(state, closingQuantity, unitPrice);

        const openingQuantity = quantity - closingQuantity;
        if (openingQuantity > 1e-9) {
            resetPositionState(state);
            openPositionLots(state, side, openingQuantity, unitPrice);
        }
        return realizedDelta;
    }

    function getMoneyMarketTickerSet() {
        const configuredTickers = window.ANTIGRAVITY_INVESTMENT_DATA?.money_market_tickers || [];
        return new Set(
            configuredTickers
                .map((ticker) => String(ticker || '').trim().toUpperCase())
                .filter(Boolean)
        );
    }

    function getLatestTransactionHistoryEquity(processedTransactions) {
        const latestRecord = Array.isArray(processedTransactions) && processedTransactions.length
            ? processedTransactions[processedTransactions.length - 1]
            : null;
        const totalEquity = Number(latestRecord?.total_equity);
        return Number.isFinite(totalEquity) ? totalEquity : 0;
    }

    function normalizeLedgerDate(value) {
        const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
        return match ? match[1] : '';
    }

    function buildTickerPriceIndex(tickerClosePrices) {
        const priceIndex = {};
        Object.entries(tickerClosePrices || {}).forEach(([ticker, dateMap]) => {
            const dates = Object.keys(dateMap || {}).sort();
            priceIndex[ticker] = {
                dates,
                closes: { ...(dateMap || {}) },
            };
        });
        return priceIndex;
    }

    function normalizePriceHistoryPayload(priceHistoryByTicker) {
        const normalized = {};
        Object.entries(priceHistoryByTicker || {}).forEach(([ticker, rows]) => {
            const normalizedTicker = normalizeInvestmentTicker(ticker);
            if (!normalizedTicker || !Array.isArray(rows)) return;
            normalized[normalizedTicker] = {};
            rows.forEach((row) => {
                const date = normalizeLedgerDate(row?.date);
                const close = Number(row?.close);
                if (!date || !Number.isFinite(close)) return;
                normalized[normalizedTicker][date] = close;
            });
        });
        return normalized;
    }

    function getIndexedClosePriceOnOrBefore(priceEntry, targetDate) {
        if (!priceEntry || !targetDate) return null;
        const dates = Array.isArray(priceEntry.dates) ? priceEntry.dates : [];
        for (let index = dates.length - 1; index >= 0; index -= 1) {
            if (dates[index] <= targetDate) {
                return Number(priceEntry.closes?.[dates[index]]);
            }
        }
        return null;
    }

    function buildValuationStatus({ backendFailures = [], fallbackTickers = [], missingTickers = [] } = {}) {
        const normalizedBackendFailures = Array.isArray(backendFailures) ? backendFailures : [];
        const normalizedFallbackTickers = Array.from(new Set((Array.isArray(fallbackTickers) ? fallbackTickers : [])
            .map((ticker) => normalizeInvestmentTicker(ticker))
            .filter(Boolean)));
        const normalizedMissingTickers = Array.from(new Set((Array.isArray(missingTickers) ? missingTickers : [])
            .map((ticker) => normalizeInvestmentTicker(ticker))
            .filter(Boolean)));
        const hasBackendFailures = normalizedBackendFailures.length > 0;
        const isDegraded = hasBackendFailures || normalizedFallbackTickers.length > 0 || normalizedMissingTickers.length > 0;
        if (!isDegraded) {
            return {
                isDegraded: false,
                message: '',
                backendFailures: normalizedBackendFailures,
                fallbackTickers: normalizedFallbackTickers,
                missingTickers: normalizedMissingTickers,
            };
        }

        const messageParts = [];
        if (normalizedMissingTickers.length) {
            messageParts.push(`Valuation is incomplete for ${normalizedMissingTickers.join(', ')} because no usable local close history was found.`);
        }
        if (normalizedFallbackTickers.length) {
            messageParts.push(`Using the latest ledger price fallback for ${normalizedFallbackTickers.join(', ')} until local market history is refreshed.`);
        }
        if (hasBackendFailures) {
            messageParts.push(normalizedBackendFailures.map((entry) => entry?.message).filter(Boolean).join(' '));
        }

        return {
            isDegraded: true,
            message: messageParts.filter(Boolean).join(' '),
            backendFailures: normalizedBackendFailures,
            fallbackTickers: normalizedFallbackTickers,
            missingTickers: normalizedMissingTickers,
        };
    }

    function calculateSnapshotMarketValue(snapshot, valuationDate, tickerPriceIndex, moneyMarketTickers) {
        if (!snapshot || !valuationDate) return { marketValue: 0, holdingsMarketValues: {} };
        let marketValue = 0;
        const holdingsMarketValues = {};

        Object.entries(snapshot.holdings || {}).forEach(([ticker, quantity]) => {
            const numericQuantity = Number(quantity);
            if (!Number.isFinite(numericQuantity) || Math.abs(numericQuantity) < 1e-9) return;

            let closePrice = getIndexedClosePriceOnOrBefore(tickerPriceIndex?.[ticker], valuationDate);
            const normalizedTicker = String(ticker).trim().toUpperCase();
            const isMoneyMarketTicker = moneyMarketTickers.has(normalizedTicker);

            if (isMoneyMarketTicker) {
                const anchoredPrice = snapshot.money_market_anchors?.[ticker] ?? snapshot.money_market_anchors?.[normalizedTicker];
                closePrice = anchoredPrice ?? closePrice;
            }

            if ((!Number.isFinite(closePrice) || closePrice === 0) && String(snapshot.ticker || '').trim().toUpperCase() === normalizedTicker) {
                const fallbackPrice = Number(snapshot.price);
                if (Number.isFinite(fallbackPrice) && fallbackPrice > 0) {
                    closePrice = fallbackPrice;
                }
            }

            const safeClosePrice = Number.isFinite(closePrice) ? closePrice : 0;
            const holdingMarketValue = numericQuantity * safeClosePrice;
            marketValue += holdingMarketValue;
            if (Math.abs(holdingMarketValue) > 1e-9) {
                holdingsMarketValues[ticker] = holdingMarketValue;
            }
        });

        return { marketValue, holdingsMarketValues };
    }

    function buildDailyEquityChartPoints(processedTransactions, tickerClosePrices, moneyMarketTickers) {
        if (!Array.isArray(processedTransactions) || !processedTransactions.length) {
            return [];
        }

        const firstLedgerDate = normalizeLedgerDate(processedTransactions[0]?.date);
        if (!firstLedgerDate) return [];

        const tickerPriceIndex = buildTickerPriceIndex(tickerClosePrices);
        const tradingDateSet = new Set();
        Object.values(tickerPriceIndex).forEach((entry) => {
            (entry?.dates || []).forEach((date) => {
                if (date >= firstLedgerDate) {
                    tradingDateSet.add(date);
                }
            });
        });

        const ledgerDateMap = new Map();
        processedTransactions.forEach((txn) => {
            const ledgerDate = normalizeLedgerDate(txn?.date);
            if (!ledgerDate) return;
            if (!ledgerDateMap.has(ledgerDate)) {
                ledgerDateMap.set(ledgerDate, {
                    snapshot: txn,
                    ledgerNos: [],
                });
            }
            const entry = ledgerDateMap.get(ledgerDate);
            entry.snapshot = txn;
            entry.ledgerNos.push(Number(txn.ledger_no || 0));
        });

        const candidateDates = Array.from(new Set([
            ...Array.from(tradingDateSet),
            ...Array.from(ledgerDateMap.keys()),
        ])).sort();

        const points = [];
        let processedCursor = 0;
        let activeSnapshot = null;

        candidateDates.forEach((date) => {
            while (processedCursor < processedTransactions.length) {
                const nextSnapshot = processedTransactions[processedCursor];
                const nextLedgerDate = normalizeLedgerDate(nextSnapshot?.date);
                if (!nextLedgerDate || nextLedgerDate > date) break;
                activeSnapshot = nextSnapshot;
                processedCursor += 1;
            }

            if (!activeSnapshot) return;

            const valuation = calculateSnapshotMarketValue(activeSnapshot, date, tickerPriceIndex, moneyMarketTickers);
            const ledgerEntry = ledgerDateMap.get(date);
            const anchorLedgerNos = Array.isArray(ledgerEntry?.ledgerNos)
                ? ledgerEntry.ledgerNos.filter((ledgerNo) => Number.isFinite(ledgerNo) && ledgerNo > 0)
                : [];

            points.push({
                date,
                running_cash: Number(activeSnapshot.running_cash) || 0,
                market_value: valuation.marketValue,
                holdings_market_values: valuation.holdingsMarketValues,
                total_equity: (Number(activeSnapshot.running_cash) || 0) + valuation.marketValue,
                anchor_ledger_date: anchorLedgerNos.length ? date : '',
                anchor_ledger_nos: anchorLedgerNos,
            });
        });

        return points;
    }

    function buildTickerSummaries(transactions, latestPrices, TOTAL_EQUITY) {
        const tickerMap = new Map();
        const orderedTransactions = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

        orderedTransactions.forEach((txn) => {
            if (!shouldTrackHoldingTicker(txn)) return;
            const ticker = String(txn.ticker).trim().toUpperCase();
            const normalizedType = getNormalizedTransactionType(txn);
            const quantity = getTransactionQuantity(txn);
            const amount = getTransactionAmount(txn);

            if (!tickerMap.has(ticker)) {
                tickerMap.set(ticker, createPositionState(ticker));
            }

            const summary = tickerMap.get(ticker);

            if (normalizedType === 'buy' && quantity !== null && !Number.isNaN(quantity)) {
                applyDirectionalTrade(summary, 'long', quantity, getTransactionEffectiveUnitPrice(txn, quantity));
                return;
            }

            if (normalizedType === 'grant' && quantity !== null && !Number.isNaN(quantity)) {
                summary.shares += quantity;
                return;
            }

            // Dividend reinvestment adds shares that were funded by a separate
            // dividend cash flow, so we should not count the reinvested amount
            // as fresh cost basis again in realized P&L reporting.
            if (normalizedType === 'dividend_reinvestment' && quantity !== null && !Number.isNaN(quantity)) {
                summary.shares += quantity;
                return;
            }

            if (normalizedType === 'sell' && quantity !== null && !Number.isNaN(quantity)) {
                applyDirectionalTrade(summary, 'short', quantity, getTransactionEffectiveUnitPrice(txn, quantity));
                return;
            }

            if (['dividend', 'foreign_tax_withholding', 'payment_in_lieu', 'adjustment'].includes(normalizedType)) {
                summary.realizedPnl += amount;
            }
        });

        return Array.from(tickerMap.values()).map((summary) => {
            const hasOpenPosition = !isFlatPosition(summary.shares);
            const averagePrice = hasOpenPosition ? (summary.totalCost / Math.abs(summary.shares)) : null;
            const lastPrice = latestPrices[summary.ticker] ?? null;
            const marketValue = hasOpenPosition && lastPrice !== null ? summary.shares * lastPrice : 0;
            const unrealizedPnl = hasOpenPosition && lastPrice !== null && averagePrice !== null
                ? (summary.shares > 0
                    ? (lastPrice - averagePrice) * summary.shares
                    : (averagePrice - lastPrice) * Math.abs(summary.shares))
                : null;
            const positionWeight = Number.isFinite(TOTAL_EQUITY) && Math.abs(TOTAL_EQUITY) > 1e-9 && hasOpenPosition
                ? (marketValue / TOTAL_EQUITY) * 100
                : 0;

            return {
                ...summary,
                averagePrice,
                lastPrice,
                marketValue,
                unrealizedPnl,
                positionWeight,
                hasOpenPosition,
            };
        }).sort((left, right) => {
            if (left.hasOpenPosition !== right.hasOpenPosition) {
                return left.hasOpenPosition ? -1 : 1;
            }
            if (left.hasOpenPosition && right.hasOpenPosition) {
                return Math.abs(right.marketValue) - Math.abs(left.marketValue);
            }
            return left.ticker.localeCompare(right.ticker);
        });
    }

    function renderHoldingsTable(summaries, tickerProfiles, TOTAL_EQUITY) {
        if (!summaries.length) {
            return `
                <div class="investment-holdings-table-shell">
                    <div class="investment-holdings-empty">No holdings or ticker-linked transactions yet.</div>
                </div>
            `;
        }

        const openSummaries = summaries.filter((summary) => summary.hasOpenPosition);
        const openCount = openSummaries.length;
        const closedCount = summaries.length - openCount;
        const totalRealizedPnl = summaries.reduce((sum, summary) => sum + (Number(summary.realizedPnl) || 0), 0);
        const totalUnrealizedPnl = summaries.reduce((sum, summary) => sum + (Number(summary.unrealizedPnl) || 0), 0);
        const cumulativePnl = totalRealizedPnl + totalUnrealizedPnl;
        const totalNetMarketValue = openSummaries.reduce((sum, summary) => sum + (Number(summary.marketValue) || 0), 0);
        const totalWeight = Number.isFinite(TOTAL_EQUITY) && Math.abs(TOTAL_EQUITY) > 1e-9
            ? (totalNetMarketValue / TOTAL_EQUITY) * 100
            : 0;
        const totalRealizedClass = totalRealizedPnl >= 0
            ? ' investment-holdings-value-positive'
            : ' investment-holdings-value-negative';
        const totalUnrealizedClass = totalUnrealizedPnl >= 0
            ? ' investment-holdings-value-positive'
            : ' investment-holdings-value-negative';
        const cumulativePnlClass = cumulativePnl >= 0
            ? ' investment-holdings-value-positive'
            : ' investment-holdings-value-negative';

        const rowsHtml = summaries.map((summary, index) => {
            const profile = tickerProfiles?.[summary.ticker] || {};
            const companyName = String(profile.company_name || summary.ticker);
            const logoUrl = String(profile.logo_url || '').trim();
            const averagePriceDisplay = summary.averagePrice === null ? '-' : formatHoldingsMoney(summary.averagePrice);
            const lastPriceDisplay = summary.lastPrice === null ? '-' : formatHoldingsMoney(summary.lastPrice);
            const realizedDisplay = formatHoldingsMoney(summary.realizedPnl);
            const unrealizedDisplay = summary.unrealizedPnl === null ? '-' : formatHoldingsMoney(summary.unrealizedPnl);
            const weightDisplay = summary.hasOpenPosition ? formatHoldingsPercent(summary.positionWeight) : '-';
            const realizedClass = summary.realizedPnl >= 0
                ? ' investment-holdings-value-positive'
                : ' investment-holdings-value-negative';
            const unrealizedClass = summary.unrealizedPnl === null
                ? ''
                : (summary.unrealizedPnl >= 0
                    ? ' investment-holdings-value-positive'
                    : ' investment-holdings-value-negative');

            return `
                <tr data-investment-holdings-ticker="${escapeHtml(summary.ticker)}">
                    <td class="investment-holdings-cell investment-holdings-cell-center">${index + 1}</td>
                    <td class="investment-holdings-cell investment-holdings-cell-ticker">
                        <a class="investment-holdings-ticker-anchor" href="#investment_stock_details_panel" data-investment-stock-link data-investment-stock-ticker="${escapeHtml(summary.ticker)}">
                            <div class="suggestion-item timing-suggestion-item ticker-identity-item investment-holdings-ticker-link" data-ticker="${escapeHtml(summary.ticker)}">
                                <div class="ticker-identity-row">
                                    ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="" class="ticker-identity-logo" loading="lazy" decoding="async" data-investment-logo-image>` : ``}
                                    <span class="ticker-identity-copy">
                                        <span class="suggestion-symbol ticker-identity-symbol">${escapeHtml(summary.ticker)}</span>
                                        <span class="suggestion-name ticker-identity-name" title="${escapeHtml(companyName)}">${escapeHtml(companyName)}</span>
                                    </span>
                                </div>
                            </div>
                        </a>
                    </td>
                    <td class="investment-holdings-cell investment-holdings-cell-money">${averagePriceDisplay}</td>
                    <td class="investment-holdings-cell investment-holdings-cell-money">${lastPriceDisplay}</td>
                    <td class="investment-holdings-cell investment-holdings-cell-money">${formatHoldingsPosition(summary.shares)}</td>
                    <td class="investment-holdings-cell investment-holdings-cell-money${realizedClass}">${realizedDisplay}</td>
                    <td class="investment-holdings-cell investment-holdings-cell-money${unrealizedClass}">${unrealizedDisplay}</td>
                    <td class="investment-holdings-cell investment-holdings-cell-money">${weightDisplay}</td>
                </tr>
            `;
        }).join('');

        const summaryRowHtml = `
            <tr class="investment-holdings-summary-row">
                <td class="investment-holdings-cell investment-holdings-cell-center"></td>
                <td class="investment-holdings-cell investment-holdings-cell-ticker">
                    <span class="investment-holdings-summary-copy">Cumulative P&amp;L: <span class="${cumulativePnlClass.trim()}">${cumulativePnl >= 0 ? '+' : '-'}${formatHoldingsMoney(Math.abs(cumulativePnl))}</span></span>
                    <span class="investment-holdings-summary-copy">${summaries.length} instruments, ${openCount} open, ${closedCount} closed</span>
                </td>
                <td class="investment-holdings-cell investment-holdings-cell-money"></td>
                <td class="investment-holdings-cell investment-holdings-cell-money"></td>
                <td class="investment-holdings-cell investment-holdings-cell-money"></td>
                <td class="investment-holdings-cell investment-holdings-cell-money${totalRealizedClass}">${formatHoldingsMoney(totalRealizedPnl)}</td>
                <td class="investment-holdings-cell investment-holdings-cell-money${totalUnrealizedClass}">${formatHoldingsMoney(totalUnrealizedPnl)}</td>
                <td class="investment-holdings-cell investment-holdings-cell-money">${formatHoldingsPercent(totalWeight)}</td>
            </tr>
        `;

        return `
            <div class="scrollable-data-table-shell investment-holdings-table-shell">
                <table class="settings-table trade-transactions-table scrollable-data-table investment-holdings-table" aria-hidden="true">
                    <thead>
                        <tr>
                            <th>No.</th>
                            <th>Ticker</th>
                            <th>Average price</th>
                            <th>Last</th>
                            <th>Position</th>
                            <th>Realized P&amp;L</th>
                            <th>Unrealized P&amp;L</th>
                            <th>%</th>
                        </tr>
                    </thead>
                </table>
                <div class="trade-transactions-wrap scrollable-data-table-scroll investment-holdings-table-scroll">
                    <table class="settings-table trade-transactions-table scrollable-data-table investment-holdings-table">
                        <tbody>${summaryRowHtml}${rowsHtml}</tbody>
                    </table>
                </div>
            </div>
        `;
    }

    function bindHoldingsHistoryInteractions(holdingsPanel) {
        if (!holdingsPanel) return;
        holdingsPanel.querySelectorAll('tr[data-investment-holdings-ticker]').forEach((row) => {
            if (row.dataset.historyHoverBound === '1') return;
            row.dataset.historyHoverBound = '1';
            const activateRelatedHistoryRow = () => {
                const ticker = row.dataset.investmentHoldingsTicker || '';
                const historyRow = getLatestHistoryRowForTicker(ticker);
                const ledgerNo = Number(historyRow?.dataset.investmentHistoryRow || 0);
                syncHoldingsChartHoverState(ticker, ledgerNo);
                if (!Number.isFinite(ledgerNo) || ledgerNo <= 0) return;
                activateInvestmentHistoryRows([ledgerNo]);
            };
            const clearRelatedHistoryRow = () => {
                syncHoldingsChartHoverState('', 0);
                clearInvestmentHistoryHighlights();
            };
            row.addEventListener('mouseenter', activateRelatedHistoryRow);
            row.addEventListener('mouseleave', clearRelatedHistoryRow);
            row.addEventListener('focusin', activateRelatedHistoryRow);
            row.addEventListener('focusout', (event) => {
                if (row.contains(event.relatedTarget)) return;
                clearRelatedHistoryRow();
            });
        });
    }

    function syncSelectedStockLinkState() {
        document.querySelectorAll('[data-investment-stock-link]').forEach((link) => {
            const ticker = normalizeInvestmentTicker(link.dataset.investmentStockTicker || '');
            link.classList.toggle('is-active', Boolean(selectedInvestmentStockTicker) && ticker === selectedInvestmentStockTicker);
        });
    }

    function bindHoldingsStockDetailsLinks(holdingsPanel) {
        if (!holdingsPanel) return;
        holdingsPanel.querySelectorAll('[data-investment-stock-link]').forEach((link) => {
            if (link.dataset.stockDetailsBound === '1') return;
            link.dataset.stockDetailsBound = '1';
            link.addEventListener('click', () => {
                selectInvestmentStockTicker(link.dataset.investmentStockTicker || '', { focusView: true });
            });
        });
        syncSelectedStockLinkState();
    }

    function bindStockDetailsHistoryInteractions(stockDetailsPanel) {
        if (!stockDetailsPanel) return;
        stockDetailsPanel.querySelectorAll('tr[data-investment-stock-detail-ledger]').forEach((row) => {
            if (row.dataset.stockHistoryBound === '1') return;
            row.dataset.stockHistoryBound = '1';
            const activateRelatedHistoryRow = () => {
                const ledgerNo = Number(row.dataset.investmentStockDetailLedger || 0);
                if (!Number.isFinite(ledgerNo) || ledgerNo <= 0) return;
                syncHoldingsChartHoverState('', ledgerNo);
                activateInvestmentStockDetailRows([ledgerNo], { behavior: 'auto', scroll: false });
                activateInvestmentHistoryRows([ledgerNo], { behavior: 'smooth', scroll: true });
            };
            const clearRelatedHistoryRow = () => {
                syncHoldingsChartHoverState('', 0);
                clearInvestmentStockDetailHighlights();
                clearInvestmentHistoryHighlights();
            };
            row.addEventListener('mouseenter', activateRelatedHistoryRow);
            row.addEventListener('mouseleave', clearRelatedHistoryRow);
            row.addEventListener('focusin', activateRelatedHistoryRow);
            row.addEventListener('focusout', (event) => {
                if (row.contains(event.relatedTarget)) return;
                clearRelatedHistoryRow();
            });
        });
    }

    function getAvailableInvestmentStockTickers() {
        if (Array.isArray(investmentTickerSummariesCache) && investmentTickerSummariesCache.length) {
            return investmentTickerSummariesCache
                .map((summary) => normalizeInvestmentTicker(summary?.ticker))
                .filter(Boolean);
        }
        return Array.from(new Set((Array.isArray(investmentProcessedTransactionsCache) ? investmentProcessedTransactionsCache : [])
            .filter((txn) => shouldTrackHoldingTicker(txn))
            .map((txn) => normalizeInvestmentTicker(txn?.ticker))
            .filter(Boolean)));
    }

    function ensureSelectedInvestmentStockTicker() {
        const availableTickers = getAvailableInvestmentStockTickers();
        if (!availableTickers.length) {
            selectedInvestmentStockTicker = '';
            return '';
        }
        if (!availableTickers.includes(selectedInvestmentStockTicker)) {
            selectedInvestmentStockTicker = availableTickers[0];
        }
        return selectedInvestmentStockTicker;
    }

    function buildInvestmentStockDetailRows(processedTransactions, ticker) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (!normalizedTicker) return [];
        const stockState = createPositionState(normalizedTicker);
        const detailRows = [];
        (Array.isArray(processedTransactions) ? processedTransactions : []).forEach((txn) => {
            if (normalizeInvestmentTicker(txn?.ticker) !== normalizedTicker) return;
            const normalizedType = getNormalizedTransactionType(txn);
            const quantity = getTransactionQuantity(txn);
            let realizedPnl = null;
            if (normalizedType === 'buy' && Number.isFinite(quantity) && quantity > 0) {
                applyDirectionalTrade(stockState, 'long', quantity, getTransactionEffectiveUnitPrice(txn, quantity));
            } else if (normalizedType === 'grant' && Number.isFinite(quantity) && quantity > 0) {
                stockState.shares += quantity;
            } else if (normalizedType === 'dividend_reinvestment' && Number.isFinite(quantity) && quantity > 0) {
                stockState.shares += quantity;
            } else if (normalizedType === 'sell' && Number.isFinite(quantity) && quantity > 0) {
                realizedPnl = applyDirectionalTrade(stockState, 'short', quantity, getTransactionEffectiveUnitPrice(txn, quantity));
            } else if (['dividend', 'foreign_tax_withholding', 'payment_in_lieu', 'adjustment'].includes(normalizedType)) {
                realizedPnl = getTransactionAmount(txn);
            }
            detailRows.push({
                ...txn,
                rowRealizedPnl: Number.isFinite(realizedPnl) ? realizedPnl : null,
            });
        });
        return detailRows.reverse();
    }

    function buildInvestmentStockDonutMarkup(summary, profile) {
        const logoUrl = resolveInvestmentLogoUrl(profile, summary?.ticker || 'stock');
        const totalPnl = (Number(summary?.realizedPnl) || 0) + (Number(summary?.unrealizedPnl) || 0);
        const donutFill = totalPnl > 1e-9
            ? 'conic-gradient(#0055cc 0deg 358.8deg, transparent 358.8deg 360deg)'
            : totalPnl < -1e-9
                ? 'conic-gradient(var(--theme-accent-secondary) 0deg 358.8deg, transparent 358.8deg 360deg)'
                : 'conic-gradient(color-mix(in srgb, var(--theme-muted) 70%, transparent) 0deg 358.8deg, transparent 358.8deg 360deg)';
        return `
            <div class="style-token-portfolio-donut-shell">
                <div class="portfolio-donut-orbit style-token-portfolio-donut-orbit" aria-hidden="true">
                    <div class="portfolio-donut-logo-layer">
                        <img class="portfolio-donut-logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(summary?.ticker || 'Ticker')} logo" loading="lazy" decoding="async" data-style-token-donut-angle="44.4">
                    </div>
                    <div class="portfolio-donut" style="--portfolio-donut-fill: ${donutFill};"></div>
                </div>
            </div>
        `;
    }

    function renderInvestmentStockDetailsPanel(tickerProfiles = {}) {
        if (!(investmentStockDetailsPanel instanceof HTMLElement)) return;
        const activeTicker = ensureSelectedInvestmentStockTicker();
        if (!activeTicker) {
            investmentStockDetailsPanel.innerHTML = `
                <div class="investment-stock-details-empty-shell">
                    <p class="investment-holdings-empty">Open Holdings or import transactions, then pick a ticker to inspect its stock details.</p>
                </div>
            `;
            syncSelectedStockLinkState();
            return;
        }
        const tickerSummary = investmentTickerSummariesCache.find((summary) => normalizeInvestmentTicker(summary?.ticker) === activeTicker) || createPositionState(activeTicker);
        const profile = tickerProfiles?.[activeTicker] || {};
        const companyName = String(profile.company_name || activeTicker);
        const logoUrl = String(profile.logo_url || '').trim();
        const detailRows = buildInvestmentStockDetailRows(investmentProcessedTransactionsCache, activeTicker);
        const totalPnl = (Number(tickerSummary.realizedPnl) || 0) + (Number(tickerSummary.unrealizedPnl) || 0);
        const totalPnlClass = totalPnl >= 0 ? 'investment-holdings-value-positive' : 'investment-holdings-value-negative';
        const realizedClass = (Number(tickerSummary.realizedPnl) || 0) >= 0 ? 'investment-holdings-value-positive' : 'investment-holdings-value-negative';
        const unrealizedClass = (Number(tickerSummary.unrealizedPnl) || 0) >= 0 ? 'investment-holdings-value-positive' : 'investment-holdings-value-negative';
        const stockMetricCards = [
            {
                label: 'Unrealized P&L',
                value: tickerSummary.unrealizedPnl === null ? '-' : formatHoldingsMoney(tickerSummary.unrealizedPnl),
                valueClass: tickerSummary.unrealizedPnl === null ? '' : unrealizedClass,
            },
            {
                label: 'Realized P&L',
                value: formatHoldingsMoney(tickerSummary.realizedPnl),
                valueClass: realizedClass,
            },
            {
                label: 'Total P&L',
                value: formatHoldingsMoney(totalPnl),
                valueClass: totalPnlClass,
            },
            {
                label: 'Position',
                value: formatHoldingsPosition(tickerSummary.shares),
                valueClass: '',
            },
            {
                label: 'Market value',
                value: tickerSummary.hasOpenPosition ? formatHoldingsMoney(tickerSummary.marketValue) : '-',
                valueClass: '',
            },
            {
                label: 'Average price',
                value: tickerSummary.averagePrice === null ? '-' : formatHoldingsMoney(tickerSummary.averagePrice),
                valueClass: '',
            },
        ];
        const rowsHtml = detailRows.length ? detailRows.map((txn) => `
            <tr data-investment-stock-detail-ledger="${txn.ledger_no}">
                <td class="investment-history-cell investment-history-cell-center">${txn.ledger_no}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatTransactionDateDisplay(txn)}</td>
                <td class="investment-history-cell investment-history-cell-center">${formatEventType(txn.type)}</td>
                <td class="investment-history-cell investment-history-cell-left">${formatTransactionDescription(txn)}</td>
                <td class="investment-history-cell investment-history-cell-center">${formatTransactionCurrency(txn)}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatAmount(txn.display_amount ?? getTransactionEconomicAmount(txn))}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatTransactionCommissionDisplay(txn)}</td>
                <td class="investment-history-cell investment-history-cell-right ${txn.rowRealizedPnl === null ? '' : (txn.rowRealizedPnl >= 0 ? 'investment-holdings-value-positive' : 'investment-holdings-value-negative')}">${txn.rowRealizedPnl === null ? '-' : formatAmountWithCurrency(txn.rowRealizedPnl, formatTransactionCurrency(txn))}</td>
            </tr>
        `).join('') : `
            <tr>
                <td colspan="8" class="investment-history-empty-cell">No ticker-linked transactions are available for this stock.</td>
            </tr>
        `;
        investmentStockDetailsPanel.innerHTML = `
            <div class="investment-stock-details-overview">
                <div class="investment-stock-details-summary">
                    <div class="suggestion-item timing-suggestion-item ticker-identity-item investment-stock-details-identity">
                        <div class="ticker-identity-row">
                            ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="" class="ticker-identity-logo" loading="lazy" decoding="async" data-investment-logo-image>` : ``}
                            <span class="ticker-identity-copy">
                                <span class="suggestion-symbol ticker-identity-symbol">${escapeHtml(activeTicker)}</span>
                                <span class="suggestion-name ticker-identity-name" title="${escapeHtml(companyName)}">${escapeHtml(companyName)}</span>
                            </span>
                        </div>
                    </div>
                    <div class="investment-stock-details-metrics">
                        ${stockMetricCards.map((metric) => `
                            <div class="trade-metric-card investment-stock-details-metric-card">
                                <span class="trade-metric-label">${metric.label}</span>
                                <span class="trade-metric-value investment-stock-details-metric-value${metric.valueClass ? ` ${metric.valueClass}` : ''}">${metric.value}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="investment-stock-details-donut-card">
                    ${buildInvestmentStockDonutMarkup(tickerSummary, profile)}
                </div>
            </div>
            <div class="scrollable-data-table-shell investment-history-table-shell investment-stock-details-table-shell">
                <table class="settings-table trade-transactions-table scrollable-data-table investment-history-table investment-stock-details-table" aria-hidden="true">
                    <thead>
                    <tr>
                        <th>No.</th>
                        <th>Time</th>
                        <th>Type</th>
                        <th>Description</th>
                        <th>Currency</th>
                        <th>Amount</th>
                        <th>Commission</th>
                        <th>Realized P&amp;L</th>
                    </tr>
                    </thead>
                </table>
                <div class="trade-transactions-wrap scrollable-data-table-scroll investment-history-table-scroll investment-stock-details-table-scroll">
                    <table class="settings-table trade-transactions-table scrollable-data-table investment-history-table investment-stock-details-table">
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
            </div>
        `;
        bindHoldingsLogoFallbacks(investmentStockDetailsPanel);
        bindStockDetailsHistoryInteractions(investmentStockDetailsPanel);
        syncSelectedStockLinkState();
        refreshPortfolioDonutOrbits(investmentStockDetailsPanel);
    }

    function selectInvestmentStockTicker(ticker, { focusView = false } = {}) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (normalizedTicker) {
            selectedInvestmentStockTicker = normalizedTicker;
        }
        renderInvestmentStockDetailsPanel(window.ANTIGRAVITY_INVESTMENT_DATA?.ticker_profiles || {});
        if (focusView) {
            setInvestmentView('stock_details');
        }
    }

    function syncInvestmentViewFromLocationHash(fallbackView = 'chart') {
        const hash = String(window.location.hash || '').trim();
        if (hash === '#investment_stock_details_panel') {
            ensureSelectedInvestmentStockTicker();
            setInvestmentView('stock_details');
            return;
        }
        setInvestmentView(fallbackView);
    }

    function bindInvestmentHistoryChartInteractions(historyContainer) {
        if (!historyContainer) return;
        historyContainer.querySelectorAll('tr[data-investment-history-row]').forEach((row) => {
            if (row.dataset.chartHoverBound === '1') return;
            row.dataset.chartHoverBound = '1';
            const activateChartMarker = () => {
                const ledgerNo = Number(row.dataset.investmentHistoryRow || 0);
                const ticker = normalizeInvestmentTicker(row.dataset.investmentHistoryTicker || '');
                syncHoldingsChartHoverState('', ledgerNo);
                activateInvestmentHistoryRows([ledgerNo], { behavior: 'auto', scroll: false });
                if (ticker) {
                    selectInvestmentStockTicker(ticker, { focusView: false });
                }
                scheduleInvestmentStockDetailRowActivation([ledgerNo], { behavior: 'auto', scroll: true });
            };
            const clearChartMarker = () => {
                syncHoldingsChartHoverState('', 0);
                clearInvestmentStockDetailHighlights();
                clearInvestmentHistoryHighlights();
            };
            row.addEventListener('mouseenter', activateChartMarker);
            row.addEventListener('mouseleave', clearChartMarker);
            row.addEventListener('focusin', activateChartMarker);
            row.addEventListener('focusout', (event) => {
                if (row.contains(event.relatedTarget)) return;
                clearChartMarker();
            });
        });
    }

    async function renderTransactionTable(transactions) {
        const tbody = document.getElementById('investment_history');
        if (!tbody) return { isDegraded: false, message: '' };
        clearInvestmentHistoryHighlights();

        if (!transactions.length) {
            setInvestmentExportButtonVisibility(false);
            syncHoldingsChartHoverState('', 0);
            resetInvestmentDashboard();
            tbody.innerHTML = `
                <tr>
                    <td colspan="10" class="investment-history-empty-cell">
                        <div class="investment-history-empty-state" role="status" aria-live="polite">
                            <p class="investment-history-empty-title"><strong>Import your IBKR files to begin.</strong></p>
                            <p class="investment-history-empty-step">➊ Click <span class="investment-inline-plus-icon" aria-hidden="true"></span> above to open the import panel.</p>
                            <p class="investment-history-empty-step">➋ Upload your Transaction History CSV and Realized Summary CSV.</p>
                            <p class="investment-history-empty-step">➌ Click Import now to rebuild this ledger and load the latest view.</p>
                        </div>
                    </td>
                </tr>
            `;
            return { isDegraded: false, message: '' };
        }

        setInvestmentExportButtonVisibility(true);

        // 1. Sort by date ascending to calculate running cash and holdings
        // Read starting_cash from top-level JSON if available, otherwise default to 0
        let runningCash = getInvestmentStartingCash();
        const holdings = {}; // {ticker: quantity}
        const moneyMarketTickers = getMoneyMarketTickerSet();
        const moneyMarketAnchors = {}; // {ticker: weightedAveragePrice}
        const priceHistoryRows = window.ANTIGRAVITY_INVESTMENT_DATA?.price_history_by_ticker || {};
        const priceHistoryFailures = window.ANTIGRAVITY_INVESTMENT_DATA?.price_history_failures || [];
        const tickerClosePrices = normalizePriceHistoryPayload(priceHistoryRows);
        const tickerPriceIndex = buildTickerPriceIndex(tickerClosePrices);
        const lastKnownTickerPrices = {};

        const orderedTransactions = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
        const processed = orderedTransactions.map((txn, processedIndex) => {
            // ========== COMPLETELY COMPATIBLE FIELD READING ==========
            // 1. Quantity: for holdings and description
            let qty = getTransactionQuantity(txn);

            // 2. Net amount: for cash calculation
            let amount = getTransactionAmount(txn);

            // 3. Price: for auto-calculating amount and market value
            let price = getTransactionPrice(txn);

            // 4. Commission: for cash impact
            let commission = 0;
            if (txn.normalized?.commission !== undefined && txn.normalized?.commission !== null) commission = Number(txn.normalized.commission);
            else if (txn.commission !== undefined && txn.commission !== null) commission = Number(txn.commission);

            // Auto-calculate amount if missing but we have quantity and price
            if ((amount === 0 || amount === undefined) && qty !== null && price !== null && ['buy', 'sell'].includes(txn.type)) {
                amount = qty * price;
            }

            // Update holdings based on transaction type
            // Normalize type first
            const normalizedType = getNormalizedTransactionType(txn);
            if (txn.ticker && qty !== null && !isNaN(qty)) {
                if (!holdings[txn.ticker]) holdings[txn.ticker] = 0;
                const normalizedTicker = String(txn.ticker).trim().toUpperCase();
                const isMoneyMarketTicker = moneyMarketTickers.has(normalizedTicker);
                if (['buy', 'dividend_reinvestment', 'grant'].includes(normalizedType)) {
                    if (isMoneyMarketTicker && price !== null && !Number.isNaN(price)) {
                        const previousQuantity = holdings[txn.ticker];
                        const previousAnchor = moneyMarketAnchors[txn.ticker] ?? price;
                        const nextQuantity = previousQuantity + qty;
                        moneyMarketAnchors[txn.ticker] = nextQuantity > 0
                            ? (((previousQuantity * previousAnchor) + (qty * price)) / nextQuantity)
                            : price;
                    }
                    holdings[txn.ticker] += qty;
                } else if (['sell'].includes(normalizedType)) {
                    holdings[txn.ticker] -= qty;
                    if (isMoneyMarketTicker && holdings[txn.ticker] > 0 && price !== null && !Number.isNaN(price)) {
                        moneyMarketAnchors[txn.ticker] = moneyMarketAnchors[txn.ticker] ?? price;
                    }
                    if (holdings[txn.ticker] <= 0) {
                        delete moneyMarketAnchors[txn.ticker];
                    }
                    if (Math.abs(holdings[txn.ticker]) < 1e-9) {
                        delete holdings[txn.ticker];
                    }
                }
            }

            if (shouldTrackHoldingTicker(txn) && price !== null && Number.isFinite(price) && price > 0) {
                lastKnownTickerPrices[String(txn.ticker).trim().toUpperCase()] = price;
            }

            // Calculate cash impact based on transaction type

            // For IBKR imported format (txn.normalized exists), net_amount already includes commission
            // and is already correctly signed: -ve = cash out, +ve = cash in. Just add directly.
            if (txn.normalized !== undefined) {
                runningCash += amount;
            } else if (['forex_trade', 'adjustment', 'fx_translation_pnl'].includes(normalizedType)) {
                // Adjustment can be any direction - use the amount sign directly
                runningCash += amount;
            } else if (normalizedType === 'deposit' || normalizedType === 'sell' || normalizedType === 'dividend' || 
                normalizedType === 'credit_interest' || normalizedType === 'payment_in_lieu') {
                // Cash in: these transactions add cash to your account
                // For manually added transactions where commission is separate
                if (normalizedType === 'sell' && amount && commission) {
                    runningCash += (amount - commission);
                } else {
                    runningCash += amount;
                }
            } else if (normalizedType === 'withdrawal' || normalizedType === 'buy' || normalizedType === 'dividend_reinvestment' || 
                       normalizedType === 'foreign_tax_withholding' || normalizedType === 'debit_interest') {
                // Cash out: these transactions remove cash from your account
                // For manually added transactions
                if (amount !== 0) {
                    runningCash += amount;
                }
            }

            // For buy/sell we already accounted for commission above
            // Only subtract commission for other types
            // For IBKR imported format (normalized), commission is already included in net_amount
            // Only subtract commission for manually added transactions where commission is separate
            const isImported = txn.normalized !== undefined;
            if (!isImported && commission && !['buy', 'sell'].includes(normalizedType)) {
                runningCash -= Math.abs(commission);
            }
            return {
                ...txn,
                ledger_no: processedIndex + 1,
                running_cash: runningCash,
                display_amount: getTransactionEconomicAmount(txn),
                holdings: { ...holdings },
                money_market_anchors: { ...moneyMarketAnchors },
            };
        });

        // Get latest price from parquet (last available close) for final valuation
        const latestPrices = {};
        Object.entries(tickerClosePrices).forEach(([ticker, dateMap]) => {
            const dates = Object.keys(dateMap).sort();
            if (dates.length > 0) {
                latestPrices[ticker] = dateMap[dates[dates.length - 1]];
            }
        });
        Object.entries(lastKnownTickerPrices).forEach(([ticker, price]) => {
            if (!Number.isFinite(latestPrices[ticker]) && Number.isFinite(price)) {
                latestPrices[ticker] = price;
            }
        });

        // 2. For each transaction, get the closest available close price on or before the transaction date
        //    and calculate total equity = cash + sum(holdings * historical close price)
        const fallbackTickers = new Set();
        const missingTickers = new Set();
        processed.forEach((txn) => {
            let marketValue = 0;
            Object.entries(txn.holdings).forEach(([ticker, quantity]) => {
                const normalizedTicker = String(ticker).trim().toUpperCase();
                const isMoneyMarketTicker = moneyMarketTickers.has(normalizedTicker);
                const valuationDate = normalizeLedgerDate(txn.date);
                let closePrice = getIndexedClosePriceOnOrBefore(tickerPriceIndex[normalizedTicker], valuationDate);
                if (isMoneyMarketTicker) {
                    const sameDaySellPrice = normalizedTicker === String(txn.ticker || '').trim().toUpperCase()
                        && getNormalizedTransactionType(txn) === 'sell'
                        ? getTransactionPrice(txn)
                        : null;
                    const anchoredPrice = txn.money_market_anchors?.[ticker] ?? txn.money_market_anchors?.[normalizedTicker];
                    closePrice = sameDaySellPrice ?? anchoredPrice ?? closePrice;
                }
                if (!Number.isFinite(closePrice) || Math.abs(closePrice) < 1e-9) {
                    const fallbackPrice = lastKnownTickerPrices[normalizedTicker];
                    if (Number.isFinite(fallbackPrice) && fallbackPrice > 0) {
                        closePrice = fallbackPrice;
                        fallbackTickers.add(normalizedTicker);
                    } else {
                        closePrice = 0;
                        missingTickers.add(normalizedTicker);
                    }
                }
                marketValue += quantity * closePrice;
            });
            txn.market_value = marketValue;
            txn.total_equity = txn.running_cash + marketValue;
        });

        Object.keys(latestPrices).forEach((ticker) => {
            if (moneyMarketTickers.has(String(ticker).trim().toUpperCase())) {
                const lastProcessedWithAnchor = [...processed].reverse().find((txn) => (
                    txn.money_market_anchors?.[ticker] !== undefined
                ));
                if (lastProcessedWithAnchor) {
                    latestPrices[ticker] = lastProcessedWithAnchor.money_market_anchors[ticker];
                }
            }
        });

        const latestSnapshot = processed[processed.length - 1];
        const chartPoints = buildDailyEquityChartPoints(processed, tickerClosePrices, moneyMarketTickers);
        const valuationStatus = buildValuationStatus({
            backendFailures: priceHistoryFailures,
            fallbackTickers: Array.from(fallbackTickers),
            missingTickers: Array.from(missingTickers),
        });

        // 3. Render reverse chronological (newest first)
        tbody.innerHTML = [...processed].reverse().map((txn, index) => {
            const description = formatTransactionDescription(txn);

            return `
            <tr id="investment_history_row_${txn.ledger_no}" data-investment-history-row="${txn.ledger_no}" data-investment-history-date="${escapeHtml(String(txn.date || '').slice(0, 10))}" data-investment-history-ticker="${escapeHtml(String(txn.ticker || '').trim().toUpperCase())}">
                <td class="investment-history-cell investment-history-cell-center">${txn.ledger_no}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatTransactionDateDisplay(txn)}</td>
                <td class="investment-history-cell investment-history-cell-center">${formatEventType(txn.type)}</td>
                <td class="investment-history-cell investment-history-cell-left">${description}</td>
                <td class="investment-history-cell investment-history-cell-center">${formatTransactionCurrency(txn)}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatAmount(txn.display_amount)}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatTransactionCommissionDisplay(txn)}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatAmount(txn.market_value)}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatAmount(txn.running_cash)}</td>
                <td class="investment-history-cell investment-history-cell-right investment-history-cell-emphasis"><strong>${formatAmount(txn.total_equity)}</strong></td>
            </tr>
            `;
        }).join('');
        bindInvestmentHistoryChartInteractions(tbody);

        // 4. Update dashboard with latest total equity
        updateDashboardWithEquity(processed, latestSnapshot, latestPrices, transactions, chartPoints);
        return valuationStatus;
    }

    function updateDashboardWithEquity(processed, latestSnapshot, latestPrices, rawTransactions, chartPoints = []) {
        const last = latestSnapshot || processed[processed.length - 1];
        if (!last) return;
        const TOTAL_EQUITY = getLatestTransactionHistoryEquity(processed);

        const holdingsPanel = document.getElementById('investment_holdings_panel');
        const metricsPanel = document.getElementById('investment_metrics_panel');
        if (!holdingsPanel || !metricsPanel || !(investmentStockDetailsPanel instanceof HTMLElement)) return;
        const shouldAnimateVisibleMetricsPanel = activeInvestmentView === 'holdings' || activeInvestmentView === 'metrics' || activeInvestmentView === 'stock_details';
        if (shouldAnimateVisibleMetricsPanel) {
            lockInvestmentSurfaceHeight();
        }

        const fundingMetrics = getUsdFundingMetrics(rawTransactions);

        const tickerProfiles = window.ANTIGRAVITY_INVESTMENT_DATA?.ticker_profiles || {};
        investmentDummyTickerProfiles = tickerProfiles;
        const tickerSummaries = buildTickerSummaries(rawTransactions, latestPrices, TOTAL_EQUITY);
        investmentProcessedTransactionsCache = Array.isArray(processed) ? [...processed] : [];
        investmentTickerSummariesCache = Array.isArray(tickerSummaries) ? [...tickerSummaries] : [];
        syncHoldingsChartHoverState('', 0);
        holdingsPanel.innerHTML = renderHoldingsTable(tickerSummaries, tickerProfiles, TOTAL_EQUITY);
        bindHoldingsLogoFallbacks(holdingsPanel);
        bindHoldingsHistoryInteractions(holdingsPanel);
        bindHoldingsStockDetailsLinks(holdingsPanel);
        syncHoldingsStickyOffset(holdingsPanel);
        renderInvestmentStockDetailsPanel(tickerProfiles);
        const latestChartPoint = Array.isArray(chartPoints) && chartPoints.length ? chartPoints[chartPoints.length - 1] : null;
        renderInvestmentDummyPortfolioDonut(latestChartPoint || {
            running_cash: Number(last?.running_cash) || 0,
            total_equity: Number(last?.total_equity) || Number(last?.running_cash) || 0,
            holdings_market_values: {},
        }, tickerProfiles);

        metricsPanel.innerHTML = renderFundingMetricCards(fundingMetrics);
        bindInvestmentMetricTooltipInteractions(metricsPanel);
        if (shouldAnimateVisibleMetricsPanel) {
            animateInvestmentSurfaceHeight();
        }
        renderEquityChartWithEquity(chartPoints);
        syncInvestmentDummyDonutFromInteraction();
    }

    function syncHoldingsStickyOffset(holdingsPanel) {
        if (!holdingsPanel) return;
        const tableShell = holdingsPanel.querySelector('.investment-holdings-table-shell');
        const headerTable = tableShell?.querySelector('.investment-holdings-table[aria-hidden="true"]');
        if (!tableShell || !headerTable) return;
        const headerHeight = Math.ceil(headerTable.getBoundingClientRect().height);
        tableShell.style.setProperty('--investment-holdings-sticky-offset', `${headerHeight}px`);
    }

    // Reuse the same chart styling from the backtest page
    function renderEquityChartWithEquity(chartPoints) {
        if (!chartPoints.length || !window.Chart) {
            if (investmentEquityChartInstance) {
                investmentEquityChartInstance.destroy();
                investmentEquityChartInstance = null;
            }
            setInvestmentChartReady(false);
            console.warn('Chart.js not available');
            return;
        }

        const container = document.getElementById('investment_equity_chart');
        if (!container) {
            if (investmentEquityChartInstance) {
                investmentEquityChartInstance.destroy();
                investmentEquityChartInstance = null;
            }
            setInvestmentChartReady(false);
            console.warn('Chart container not found');
            return;
        }

        container.innerHTML = `<canvas id="investmentEquityChart"></canvas>`;
        const canvas = document.getElementById('investmentEquityChart');
        const existingChart = window.Chart.getChart?.(canvas);
        if (existingChart) existingChart.destroy();
        if (investmentEquityChartInstance) {
            investmentEquityChartInstance.destroy();
            investmentEquityChartInstance = null;
        }
        setInvestmentChartReady(false, canvas);

        const sortedChartPoints = [...chartPoints].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
        const rawDates = sortedChartPoints.map((point) => point.date);
        const equity = sortedChartPoints.map((point) => point.total_equity);
        const chartPointIndexByLedgerNo = new Map();
        sortedChartPoints.forEach((point, index) => {
            const ledgerNos = Array.isArray(point?.anchor_ledger_nos) ? point.anchor_ledger_nos : [];
            ledgerNos.forEach((ledgerNo) => {
                const normalizedLedgerNo = Number(ledgerNo);
                if (!Number.isFinite(normalizedLedgerNo) || normalizedLedgerNo <= 0) return;
                chartPointIndexByLedgerNo.set(normalizedLedgerNo, index);
            });
        });
        investmentChartPointsCache = sortedChartPoints;
        investmentChartPointIndexByLedgerNo = chartPointIndexByLedgerNo;
        investmentLatestChartPoint = sortedChartPoints[sortedChartPoints.length - 1] || null;
        activeChartTooltipPointIndex = -1;

        // Read theme tokens
        const resolvedTheme = (() => {
            const computed = getComputedStyle(document.body);
            return {
                text: computed.getPropertyValue("--theme-text").trim(),
                muted: computed.getPropertyValue("--theme-muted").trim(),
                accentPrimary: computed.getPropertyValue("--theme-accent-primary").trim(),
                accentPositive: computed.getPropertyValue("--theme-accent-positive").trim(),
                accentSecondary: computed.getPropertyValue("--theme-accent-secondary").trim(),
            };
        })();
        const equitySeriesColor = resolvedTheme.accentPrimary || "#0055cc";

        const labels = [...rawDates];
        const fixedYAxisWidth = 52;
        const monthAbbreviations = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        let activeChartHoverDate = "";

        const formatMoney = (value) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

        const parseRawDate = (value) => {
            if (typeof value !== "string") return null;
            const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (!match) return null;
            return {
                year: Number(match[1]),
                monthIndex: Number(match[2]) - 1,
                day: Number(match[3]),
            };
        };

        const formatRawDate = (date) => {
            const year = date.getFullYear();
            const month = `${date.getMonth() + 1}`.padStart(2, "0");
            const day = `${date.getDate()}`.padStart(2, "0");
            return `${year}-${month}-${day}`;
        };

        const formatChartDateLines = (dateParts) => [
            `${dateParts.day} ${monthAbbreviations[dateParts.monthIndex]}`,
            `${dateParts.year}`
        ];

        const buildTickIndexSet = (count, plotWidth) => {
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
        };

        const collectFiniteValues = (datasets) => {
            if (!Array.isArray(datasets)) return [];
            return datasets.flatMap((dataset) => (Array.isArray(dataset) ? dataset : []))
                .map((value) => Number(value))
                .filter((value) => Number.isFinite(value));
        };

        const buildPixelPaddedYScale = (canvas, datasets, paddingPx) => {
            const values = collectFiniteValues(datasets);
            if (!values.length) return {};
            const rawMin = Math.min(...values);
            const rawMax = Math.max(...values);
            if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) return {};
            if (rawMin === rawMax) {
                const fallbackPadding = Math.abs(rawMin || 1) * 0.02 || 1;
                return {
                    min: rawMin - fallbackPadding,
                    max: rawMax + fallbackPadding,
                    rawMin,
                    rawMax,
                };
            }
            const canvasHeight = Math.max(canvas?.clientHeight || 0, 80);
            const safePaddingPx = Math.max(0, paddingPx);
            const usableHeight = Math.max(canvasHeight - (safePaddingPx * 2), 1);
            const dataRange = rawMax - rawMin;
            const dataPadding = dataRange * (safePaddingPx / usableHeight);
            return {
                min: rawMin - dataPadding,
                max: rawMax + dataPadding,
                rawMin,
                rawMax,
            };
        };

        const hoverGuidePlugin = {
            id: "investmentHoverGuidePlugin",
            afterDatasetsDraw(chartInstance) {
                const { ctx, chartArea, tooltip } = chartInstance;
                if (!chartArea || !tooltip || tooltip.opacity === 0) return;
                const x = tooltip.caretX;
                if (!Number.isFinite(x) || x < chartArea.left || x > chartArea.right) return;
                ctx.save();
                ctx.strokeStyle = resolvedTheme.muted;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, chartArea.top);
                ctx.lineTo(x, chartArea.bottom);
                ctx.stroke();
                ctx.restore();
            },
        };

        const animateHoldingsMarkerToward = (targetPoint, chartInstance) => {
            if (!targetPoint) {
                animatedHoldingsMarkerPoint = null;
                animatedHoldingsMarkerTarget = null;
                if (animatedHoldingsMarkerFrame) {
                    window.cancelAnimationFrame(animatedHoldingsMarkerFrame);
                    animatedHoldingsMarkerFrame = 0;
                }
                return;
            }
            const normalizedTarget = {
                x: Number(targetPoint.x),
                y: Number(targetPoint.y),
            };
            if (!Number.isFinite(normalizedTarget.x) || !Number.isFinite(normalizedTarget.y)) return;
            const sameTarget = animatedHoldingsMarkerTarget
                && Math.abs(animatedHoldingsMarkerTarget.x - normalizedTarget.x) < 0.25
                && Math.abs(animatedHoldingsMarkerTarget.y - normalizedTarget.y) < 0.25;
            animatedHoldingsMarkerTarget = normalizedTarget;
            if (!animatedHoldingsMarkerPoint) {
                animatedHoldingsMarkerPoint = { ...normalizedTarget };
                return;
            }
            if (sameTarget) return;
            const startPoint = { ...animatedHoldingsMarkerPoint };
            animatedHoldingsMarkerStartTime = performance.now();
            if (animatedHoldingsMarkerFrame) {
                window.cancelAnimationFrame(animatedHoldingsMarkerFrame);
            }
            const step = (now) => {
                const progress = Math.min(1, (now - animatedHoldingsMarkerStartTime) / 300);
                const eased = easeOutCubic(progress);
                animatedHoldingsMarkerPoint = {
                    x: startPoint.x + ((normalizedTarget.x - startPoint.x) * eased),
                    y: startPoint.y + ((normalizedTarget.y - startPoint.y) * eased),
                };
                chartInstance.draw();
                if (progress < 1) {
                    animatedHoldingsMarkerFrame = window.requestAnimationFrame(step);
                    return;
                }
                animatedHoldingsMarkerPoint = { ...normalizedTarget };
                animatedHoldingsMarkerFrame = 0;
            };
            animatedHoldingsMarkerFrame = window.requestAnimationFrame(step);
        };

        const holdingsHoverMarkerPlugin = {
            id: "investmentHoldingsHoverMarkerPlugin",
            afterDatasetsDraw(chartInstance) {
                const ledgerNo = Number(activeHoldingsHoverLedgerNo);
                if (!Number.isFinite(ledgerNo) || ledgerNo <= 0) {
                    animateHoldingsMarkerToward(null, chartInstance);
                    return;
                }
                const pointIndex = chartPointIndexByLedgerNo.get(ledgerNo);
                if (!Number.isFinite(pointIndex)) return;
                const dataset = chartInstance.data?.datasets?.[0];
                const pointValue = Number(dataset?.data?.[pointIndex]);
                if (!Number.isFinite(pointValue)) return;
                const { ctx, scales, chartArea } = chartInstance;
                const xScale = scales?.x;
                const yScale = scales?.y;
                if (!ctx || !xScale || !yScale || !chartArea) return;
                const x = xScale.getPixelForValue(pointIndex);
                const y = yScale.getPixelForValue(pointValue);
                if (!Number.isFinite(x) || !Number.isFinite(y)) return;
                if (x < chartArea.left || x > chartArea.right || y < chartArea.top || y > chartArea.bottom) return;
                animateHoldingsMarkerToward({ x, y }, chartInstance);
                const animatedPoint = animatedHoldingsMarkerPoint || { x, y };
                const markerStroke = resolvedTheme.accentPositive || "#16a34a";
                const markerGlow = resolvedTheme.accentPositive || "rgba(22, 163, 74, 0.85)";
                ctx.save();
                ctx.beginPath();
                ctx.arc(animatedPoint.x, animatedPoint.y, 5, 0, Math.PI * 2);
                ctx.lineWidth = 2.8;
                ctx.strokeStyle = markerStroke;
                ctx.shadowColor = markerGlow;
                ctx.shadowBlur = 12;
                ctx.stroke();
                ctx.restore();
            },
        };

        const xAxisLabelPlugin = {
            id: "investmentXAxisLabelPlugin",
            afterDraw(chart) {
                const { ctx, chartArea, scales } = chart;
                const xScale = scales?.x;
                if (!chartArea || !xScale || !labels.length) return;
                const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
                const tickIndexes = Array.from(buildTickIndexSet(labels.length, viewportWidth)).sort((left, right) => left - right);
                const baselineY = chartArea.bottom;
                const lineHeight = 10;
                ctx.save();
                ctx.fillStyle = resolvedTheme.muted;
                ctx.font = '700 12px "GDS Transport", "Helvetica Neue", Arial, sans-serif';
                ctx.textBaseline = "top";
                tickIndexes.forEach((index, tickIndex) => {
                    const parsedDate = parseRawDate(rawDates[index]);
                    if (!parsedDate) return;
                    const [firstLine, secondLine] = formatChartDateLines(parsedDate);
                    const x = xScale.getPixelForValue(index);
                    if (!Number.isFinite(x)) return;
                    if (tickIndex === 0) ctx.textAlign = "left";
                    else if (tickIndex === tickIndexes.length - 1) ctx.textAlign = "right";
                    else ctx.textAlign = "center";
                    ctx.fillText(firstLine, x, baselineY);
                    ctx.fillText(secondLine, x, baselineY + lineHeight);
                });
                ctx.restore();
            },
        };

        const chartYPaddingPx = 5;
        const equityYScale = buildPixelPaddedYScale(canvas, [equity], chartYPaddingPx);
        const getOrCreateTooltip = (chart) => {
            let tooltip = document.querySelector('[data-investment-chart-tooltip="1"]');
            if (tooltip) return tooltip;
            tooltip = document.createElement("div");
            tooltip.className = "chart-tooltip";
            tooltip.dataset.investmentChartTooltip = "1";
            tooltip.style.position = "fixed";
            tooltip.innerHTML = '<p class="chart-tooltip-date"></p><div class="chart-tooltip-list"></div>';
            document.body.appendChild(tooltip);
            return tooltip;
        };

        const formatTooltipDate = (dateParts) => `${dateParts.day} ${monthAbbreviations[dateParts.monthIndex]} ${dateParts.year}`;

        const externalTooltipHandler = ({ chart, tooltip }) => {
            const tooltipEl = getOrCreateTooltip(chart);
            if (tooltip.opacity === 0) {
                tooltipEl.classList.remove("is-visible");
                activeChartHoverDate = "";
                activeChartTooltipPointIndex = -1;
                clearInvestmentHistoryHighlights();
                syncInvestmentDummyDonutFromInteraction();
                return;
            }

            const dateEl = tooltipEl.querySelector(".chart-tooltip-date");
            const listEl = tooltipEl.querySelector(".chart-tooltip-list");
            const pointIndex = tooltip.dataPoints?.[0]?.dataIndex ?? -1;
            const parsedDate = parseRawDate(rawDates[pointIndex]);
            const pointRecord = sortedChartPoints[pointIndex];
            activeChartTooltipPointIndex = Number.isFinite(pointIndex) && pointIndex >= 0 ? pointIndex : -1;
            syncInvestmentDummyDonutFromInteraction();
            dateEl.textContent = parsedDate ? formatTooltipDate(parsedDate) : (tooltip.title?.[0] || "");
            const hoveredLedgerDate = String(pointRecord?.anchor_ledger_date || "").slice(0, 10);

            if (hoveredLedgerDate && hoveredLedgerDate !== activeChartHoverDate) {
                const ledgerNos = Array.isArray(pointRecord?.anchor_ledger_nos)
                    ? pointRecord.anchor_ledger_nos
                    : getHistoryRowsForLedgerDate(hoveredLedgerDate).map((row) => Number(row.dataset.investmentHistoryRow || 0));
                activateInvestmentHistoryRows(ledgerNos, { behavior: "smooth" });
                activeChartHoverDate = hoveredLedgerDate;
            } else if (!hoveredLedgerDate && activeChartHoverDate) {
                activeChartHoverDate = "";
                clearInvestmentHistoryHighlights();
            }

            const tooltipRows = [];
            if (pointRecord) {
                tooltipRows.push({
                    label: "Equity",
                    value: pointRecord.total_equity,
                    color: equitySeriesColor,
                });
                tooltipRows.push({
                    label: "Market value",
                    value: pointRecord.market_value,
                    color: resolvedTheme.accentSecondary,
                });
                tooltipRows.push({
                    label: "Cash",
                    value: pointRecord.running_cash,
                    color: resolvedTheme.accentPositive,
                });
            } else {
                tooltipRows.push({
                    label: "Equity",
                    value: tooltip.dataPoints?.[0]?.parsed?.y ?? null,
                    color: equitySeriesColor,
                });
            }

            listEl.innerHTML = tooltipRows.map((row) => `
                <div class="chart-tooltip-row">
                    <span class="chart-tooltip-dot" style="background:${row.color}"></span>
                    <span></span>
                    <span class="chart-tooltip-label">${row.label}</span>
                    <span class="chart-tooltip-value">${formatMoney(row.value)}</span>
                </div>
            `).join("");

            const canvasRect = chart.canvas.getBoundingClientRect();
            const tooltipRect = tooltipEl.getBoundingClientRect();
            const padding = 12;
            const gap = 14;
            const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 0;
            const viewportHeight = document.documentElement.clientHeight || window.innerHeight || 0;
            const anchorX = canvasRect.left + tooltip.caretX;
            const anchorY = canvasRect.top + tooltip.caretY;
            const donutRect = investmentDummyChart instanceof HTMLElement ? investmentDummyChart.getBoundingClientRect() : null;
            const rightBoundary = donutRect && donutRect.left > padding
                ? Math.min(viewportWidth - padding, donutRect.left - gap)
                : viewportWidth - padding;
            const roomRight = rightBoundary - anchorX;
            const roomLeft = anchorX - padding;
            const preferRight = roomRight >= tooltipRect.width + gap || roomRight >= roomLeft;
            let left = preferRight ? anchorX + gap : anchorX - tooltipRect.width - gap;
            if (left < padding) left = padding;
            const maxLeft = rightBoundary - tooltipRect.width;
            if (left > maxLeft) {
                left = maxLeft;
            }
            if (left < padding) left = padding;
            let top = anchorY - (tooltipRect.height / 2);
            if (top < padding) top = padding;
            if (top + tooltipRect.height > viewportHeight - padding) {
                top = viewportHeight - tooltipRect.height - padding;
            }
            tooltipEl.style.left = `${left}px`;
            tooltipEl.style.top = `${top}px`;
            tooltipEl.classList.add("is-visible");
        };

        const commonOptions = {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { bottom: 24 } },
            interaction: { mode: "index", intersect: false },
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
                    bounds: "ticks",
                    grid: { display: false, drawTicks: false },
                    border: { display: false },
                    afterFit: (scale) => {
                        scale.width = fixedYAxisWidth;
                    },
                    ticks: {
                        color: resolvedTheme.muted,
                        display: true,
                        padding: 8,
                        callback(value, index, ticks) {
                            if (index === 0 || index === ticks.length - 1) return "";
                            return typeof this.getLabelForValue === "function" ? this.getLabelForValue(value) : String(value);
                        },
                    },
                },
            },
        };

        investmentEquityChartInstance = new Chart(canvas, {
            type: "line",
            data: {
                labels,
                rawLabels: rawDates,
                datasets: [
                    {
                        label: "Equity",
                        data: equity,
                        borderColor: equitySeriesColor,
                        borderWidth: 2.5,
                        pointRadius: 0,
                        tension: 0,
                        borderJoinStyle: "round",
                        borderCapStyle: "round",
                    },
                ],
            },
            options: {
                ...commonOptions,
                animation: {
                    onComplete: () => {
                        if (canvas.dataset.investmentChartReady === '1') return;
                        setInvestmentChartReady(true, canvas);
                    },
                },
                scales: {
                    ...commonOptions.scales,
                    x: { ...commonOptions.scales.x, display: false },
                    y: { ...commonOptions.scales.y, ...equityYScale },
                },
            },
            plugins: [hoverGuidePlugin, holdingsHoverMarkerPlugin, xAxisLabelPlugin],
        });
        if (activeHoldingsHoverLedgerNo > 0) {
            investmentEquityChartInstance.update('none');
        }
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                if (canvas.dataset.investmentChartReady === '1') return;
                setInvestmentChartReady(true, canvas);
            });
        });
    }

    function formatEventType(type) {
        if (!type) return '';
        return type.split('_').map(word => {
            // Special case capitalization for IBKR transaction types
            const lower = word.toLowerCase();
            if (lower === 'fx') return 'FX';
            if (lower === 'pnl') return 'P&L';
            return word.charAt(0).toUpperCase() + word.slice(1);
        }).join(' ');
    }

    function formatAmount(value) {
        if (value === undefined || value === null || isNaN(value)) return '--';
        return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function getTotalDeposits(transactions) {
        return transactions
            .filter(t => getNormalizedTransactionType(t) === 'deposit')
            .reduce((sum, t) => sum + getTransactionAmount(t), 0);
    }

    function renderMetricValueWithTooltip(metric) {
        const monthAbbreviations = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const sortedLedgerEntries = Array.isArray(window.ANTIGRAVITY_INVESTMENT_DATA?.transactions)
            ? [...window.ANTIGRAVITY_INVESTMENT_DATA.transactions]
                .sort((left, right) => {
                    const leftDate = new Date(left?.date || 0).getTime();
                    const rightDate = new Date(right?.date || 0).getTime();
                    if (leftDate !== rightDate) return leftDate - rightDate;
                    const leftRow = Number(left?.source?.row_number ?? 0);
                    const rightRow = Number(right?.source?.row_number ?? 0);
                    return leftRow - rightRow;
                })
                .map((txn, index) => ({
                    ledgerNo: index + 1,
                    date: String(txn?.date || ''),
                }))
            : [];
        const ledgerDateMap = new Map(sortedLedgerEntries.map((entry) => [entry.ledgerNo, entry.date]));
        const formatTooltipLedgerDate = (rawDate) => {
            const match = String(rawDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (!match) return '';
            const day = Number(match[3]);
            const monthIndex = Number(match[2]) - 1;
            const year = Number(match[1]);
            return `${day} ${monthAbbreviations[monthIndex] || ''} ${year}`.trim();
        };
        const rows = Array.isArray(metric?.rows) ? [...metric.rows].sort((left, right) => right - left) : [];
        const visibleRows = rows.slice(0, 4);
        const extraCount = Math.max(0, rows.length - visibleRows.length);
        const rowListHtml = visibleRows.length
            ? `
                <ul class="investment-metric-tooltip-list">
                    ${visibleRows.map((rowNo) => `
                        <li>
                            <span class="investment-metric-tooltip-list-line">
                                <span class="investment-metric-tooltip-row-no">${rowNo}</span>
                                <span class="investment-metric-tooltip-row-date">${formatTooltipLedgerDate(ledgerDateMap.get(rowNo))}</span>
                            </span>
                        </li>
                    `).join('')}
                </ul>
                ${extraCount > 0 ? `<p class="investment-metric-tooltip-note">+ ${extraCount} earlier row${extraCount === 1 ? '' : 's'}</p>` : ''}
            `
            : `<p class="investment-metric-tooltip-note">No contributing rows were detected.</p>`;
        const latestRow = rows.length ? rows[0] : '';

        return `
            <span class="investment-metric-tooltip-trigger" tabindex="0" data-metric-key="${metric?.key || ''}" data-metric-target-row="${latestRow}">
                <span class="trade-metric-value" data-workspace-mask="trade-metric">${metric?.value || '--'}</span>
                <span class="investment-metric-tooltip field-tooltip liquid-glass-surface" role="tooltip">
                    <span class="investment-metric-tooltip-copy">${metric?.summary || ''}</span>
                    ${rowListHtml}
                </span>
            </span>
        `;
    }

    function bindInvestmentMetricTooltipInteractions(metricsPanel) {
        if (!metricsPanel) return;
        metricsPanel.querySelectorAll('.investment-metric-tooltip-trigger').forEach((trigger) => {
            if (trigger.dataset.tooltipBound === '1') return;
            trigger.dataset.tooltipBound = '1';
            const jumpToContributionRow = () => {
                const targetRowNo = Number(trigger.dataset.metricTargetRow);
                if (!Number.isFinite(targetRowNo) || targetRowNo <= 0) return;
                activateInvestmentHistoryRows([targetRowNo]);
            };
            const clearContributionRow = () => {
                clearInvestmentHistoryHighlights();
            };
            trigger.addEventListener('mouseenter', jumpToContributionRow);
            trigger.addEventListener('focus', jumpToContributionRow);
            trigger.addEventListener('mouseleave', clearContributionRow);
            trigger.addEventListener('blur', clearContributionRow);
        });
    }

    function getNetUsdConverted(transactions) {
        return getUsdFundingMetrics(transactions).netUsdConverted;
    }

    function getUsdFundingMetrics(transactions) {
        if (!Array.isArray(transactions)) {
            return {
                totalDeposits: 0,
                directUsdDeposits: 0,
                netUsdConverted: 0,
                fxFundingLoss: 0,
                finalInvestableUsd: 0,
                directDepositRows: [],
                netUsdConvertedRows: [],
                fxFundingLossRows: [],
                finalInvestableUsdRows: [],
            };
        }

        const sortedTransactions = transactions
            .map((txn, index) => ({ txn, index }))
            .sort((left, right) => {
                const leftDate = new Date(left.txn?.date || 0).getTime();
                const rightDate = new Date(right.txn?.date || 0).getTime();
                if (leftDate !== rightDate) return leftDate - rightDate;
                const leftRow = Number(left.txn?.source?.row_number ?? left.index);
                const rightRow = Number(right.txn?.source?.row_number ?? right.index);
                return leftRow - rightRow;
            })
            .map(({ txn, index }, sortedIndex) => ({
                txn,
                index,
                ledgerNo: sortedIndex + 1,
            }));

        const currentDepositStreak = [];
        const allDepositRows = [];
        let totalDeposits = 0;
        let pairedDepositFunding = 0;
        let netUsdConverted = 0;
        let pairedNetUsdConverted = 0;
        const pairedDepositRowSet = new Set();
        const netUsdConvertedRowSet = new Set();
        const pairedNetUsdConvertedRowSet = new Set();

        const getFundingTolerance = (targetAmount) => Math.max(0.01, targetAmount * 0.001);
        const chooseClosestDepositSubset = (entries, targetAmount) => {
            const itemCount = entries.length;
            if (!itemCount) return null;

            let bestMask = 0;
            let bestTotal = 0;
            let bestDiff = Number.POSITIVE_INFINITY;
            const subsetCount = 1 << itemCount;

            for (let mask = 1; mask < subsetCount; mask += 1) {
                let subsetTotal = 0;
                for (let bit = 0; bit < itemCount; bit += 1) {
                    if (mask & (1 << bit)) subsetTotal += entries[bit].amount;
                }
                const diff = Math.abs(subsetTotal - targetAmount);
                if (diff < bestDiff - 1e-9 || (Math.abs(diff - bestDiff) <= 1e-9 && subsetTotal < bestTotal)) {
                    bestMask = mask;
                    bestTotal = subsetTotal;
                    bestDiff = diff;
                }
            }

            return {
                mask: bestMask,
                total: bestTotal,
                diff: bestDiff,
            };
        };

        sortedTransactions.forEach(({ txn, ledgerNo }) => {
            const normalizedType = getNormalizedTransactionType(txn);

            if (normalizedType === 'deposit') {
                const depositAmount = getTransactionAmount(txn);
                if (Number.isFinite(depositAmount) && depositAmount > 0) {
                    totalDeposits += depositAmount;
                    const depositEntry = { amount: depositAmount, ledgerNo };
                    allDepositRows.push(depositEntry);
                    currentDepositStreak.push(depositEntry);
                }
                return;
            }

            if (normalizedType !== 'forex_trade_component') {
                currentDepositStreak.length = 0;
                return;
            }

            const forexPair = String(txn?.ticker || '').trim().toUpperCase();
            if (!forexPair.startsWith('USD.')) {
                currentDepositStreak.length = 0;
                return;
            }

            const quantity = getTransactionQuantity(txn);
            const commissionDisplay = Number(txn?.normalized?.commission_display ?? txn?.commission_abs ?? 0);
            const safeQuantity = Number.isFinite(quantity) ? quantity : 0;
            const safeCommission = Number.isFinite(commissionDisplay) ? commissionDisplay : 0;
            const netConvertedAmount = safeQuantity - safeCommission;

            if (netConvertedAmount > 0) {
                netUsdConverted += netConvertedAmount;
                netUsdConvertedRowSet.add(ledgerNo);
            }

            const grossFundingTarget = safeQuantity + safeCommission;
            if (!(grossFundingTarget > 0) || currentDepositStreak.length === 0) return;

            const tolerance = getFundingTolerance(grossFundingTarget);
            const bestSubset = chooseClosestDepositSubset(currentDepositStreak, grossFundingTarget);
            if (!bestSubset || bestSubset.total <= 0 || bestSubset.diff > tolerance) {
                currentDepositStreak.length = 0;
                return;
            }

            const remainingDeposits = [];
            currentDepositStreak.forEach((entry, index) => {
                if (!(bestSubset.mask & (1 << index))) {
                    remainingDeposits.push(entry);
                } else {
                    pairedDepositRowSet.add(entry.ledgerNo);
                }
            });
            currentDepositStreak.length = 0;
            remainingDeposits.forEach((entry) => currentDepositStreak.push(entry));

            pairedDepositFunding += bestSubset.total;
            if (netConvertedAmount > 0) {
                pairedNetUsdConverted += netConvertedAmount;
                pairedNetUsdConvertedRowSet.add(ledgerNo);
            }
        });

        const directUsdDeposits = totalDeposits - pairedDepositFunding;
        const fxFundingLoss = Math.max(0, pairedDepositFunding - pairedNetUsdConverted);
        const finalInvestableUsd = directUsdDeposits + netUsdConverted;
        const directDepositRows = allDepositRows
            .map((entry) => entry.ledgerNo)
            .filter((ledgerNo) => !pairedDepositRowSet.has(ledgerNo));
        const netUsdConvertedRows = Array.from(netUsdConvertedRowSet);
        const fxFundingLossRows = Array.from(new Set([
            ...Array.from(pairedDepositRowSet),
            ...Array.from(pairedNetUsdConvertedRowSet),
        ]));
        const finalInvestableUsdRows = Array.from(new Set([
            ...directDepositRows,
            ...netUsdConvertedRows,
        ]));

        return {
            totalDeposits,
            directUsdDeposits,
            netUsdConverted,
            fxFundingLoss,
            finalInvestableUsd,
            directDepositRows,
            netUsdConvertedRows,
            fxFundingLossRows,
            finalInvestableUsdRows,
        };
    }
});
