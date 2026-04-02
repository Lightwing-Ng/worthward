/**
 * Investment transaction tracker frontend.
 *
 * Code version: v1.20.0
 * - Updated: Investment segmented control now shows "Charts"
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
    const transactionsCsvInput = document.getElementById('transactions_csv');
    const positionsCsvInput = document.getElementById('positions_csv');
    const transactionsCsvStatus = document.getElementById('transactions_csv_status');
    const positionsCsvStatus = document.getElementById('positions_csv_status');
    const segmentedControl = document.getElementById('investment_view_segmented');
    const investmentViewSurface = document.getElementById('investment_view_surface');
    const investmentViewSurfaceBody = document.getElementById('investment_view_surface_body');
    const investmentPanels = document.querySelectorAll('[data-investment-view-panel]');
    let activeInvestmentView = 'chart';
    let investmentSurfaceCleanupTimer = null;
    let investmentFormHideTimer = null;

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
        if (!nextView || nextView === activeInvestmentView) {
            return;
        }

        lockInvestmentSurfaceHeight();

        if (segmentedControl) {
            const viewOrder = ['chart', 'holdings', 'metrics'];
            const activeIndex = Math.max(viewOrder.indexOf(nextView), 0);
            segmentedControl.dataset.active = nextView;
            segmentedControl.style.setProperty('--segmented-option-count', String(viewOrder.length));
            segmentedControl.style.setProperty('--segmented-active-index', String(activeIndex));
        }
        if (investmentViewSurface) {
            investmentViewSurface.dataset.activeView = nextView;
        }
        investmentPanels.forEach((panel) => {
            panel.hidden = panel.dataset.investmentViewPanel !== nextView;
        });
        activeInvestmentView = nextView;
        animateInvestmentSurfaceHeight();
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
        setInvestmentView(checkedRadio?.value || 'chart');
        cleanupInvestmentSurfaceHeight();
    }

    function setImportFeedback(message, isError = false) {
        if (!importFeedback) return;
        importFeedback.hidden = false;
        importFeedback.textContent = message;
        importFeedback.classList.toggle('investment-import-feedback-error', Boolean(isError));
        importFeedback.classList.toggle('investment-import-feedback-success', !isError);
    }

    function clearImportFeedback() {
        if (!importFeedback) return;
        importFeedback.hidden = true;
        importFeedback.textContent = '';
        importFeedback.classList.remove('investment-import-feedback-error', 'investment-import-feedback-success');
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

    function syncImportValidationState() {
        const transactionFile = transactionsCsvInput?.files?.[0];
        const positionsFile = positionsCsvInput?.files?.[0];
        const transactionReady = isLikelyTransactionHistoryFile(transactionFile);
        const positionsReady = isLikelyPositionsFile(positionsFile);
        const importReady = transactionReady && positionsReady;

        setImportStatusIcon(transactionsCsvStatus, transactionReady);
        setImportStatusIcon(positionsCsvStatus, positionsReady);

        const submitButton = investmentForm?.querySelector('button[type="submit"]');
        if (submitButton) {
            submitButton.disabled = !importReady;
        }
    }

    // Copy shared-select initialization from base.html
    function initSharedSelectors() {
        document.querySelectorAll('[data-shared-select-field]').forEach(container => {
            if (container.dataset.sharedSelectBound === "1") return;
            const select = container.querySelector('select');
            const trigger = container.querySelector('[data-shared-select-trigger]');
            const dropdown = container.querySelector('[data-shared-select-dropdown]');
            const label = container.querySelector('[data-shared-select-trigger-label]');
            if (!select || !trigger || !dropdown) return;
            container.dataset.sharedSelectBound = "1";

            const options = Array.from(select.options).map(opt => ({
                value: opt.value,
                text: opt.text,
                selected: opt.selected,
            }));

            let currentValue = options.find(opt => opt.selected)?.value || options[0]?.value;
            label.textContent = options.find(opt => opt.value === currentValue)?.text || '';

            function renderDropdown() {
                dropdown.innerHTML = options.map(opt => `
                    <button type="button" class="trade-strategy-dropdown-item ${opt.value === currentValue ? 'is-selected' : ''}" data-value="${opt.value}">
                        ${opt.text}
                    </button>
                `).join('');
            }

            renderDropdown();

            trigger.addEventListener('click', () => {
                const isHidden = dropdown.hidden;
                dropdown.hidden = !isHidden;
                trigger.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
            });

            dropdown.addEventListener('click', (e) => {
                const btn = e.target.closest('button');
                if (!btn) return;
                const value = btn.dataset.value;
                currentValue = value;
                select.value = value;
                label.textContent = options.find(opt => opt.value === value)?.text || '';
                dropdown.hidden = true;
                trigger.setAttribute('aria-expanded', 'false');
                // Update visibility of ticker/quantity/price/commission fields based on type
                updateConditionalFields();
                // Recalculate net amount when type changes
                calculateNetAmount();
            });

            document.addEventListener('click', (e) => {
                if (!container.contains(e.target)) {
                    dropdown.hidden = true;
                    trigger.setAttribute('aria-expanded', 'false');
                }
            });
        });
    }

    // Initialize shared selectors after DOM is ready - multiple passes to ensure all get bound
    initInvestmentViewTabs();
    setTimeout(initSharedSelectors, 50);
    setTimeout(initSharedSelectors, 150);
    setTimeout(initSharedSelectors, 300);
    // Update conditional fields after everything is initialized
    setTimeout(updateConditionalFields, 350);
    syncImportValidationState();
    [transactionsCsvInput, positionsCsvInput].forEach((input) => {
        if (input) {
            input.addEventListener('change', () => {
                clearImportFeedback();
                syncImportValidationState();
            });
        }
    });

    function getInvestmentFormOffset() {
        if (!formContainer) return 0;
        const marginTop = Number.parseFloat(window.getComputedStyle(formContainer).marginTop || '0') || 0;
        return Math.ceil(formContainer.getBoundingClientRect().height + marginTop);
    }

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
            } else {
                if (investmentFormHideTimer) {
                    window.clearTimeout(investmentFormHideTimer);
                    investmentFormHideTimer = null;
                }
                formContainer.style.display = 'block';
                syncInvestmentFormLayout();
                setTimeout(() => {
                    formContainer.style.opacity = '1';
                    formContainer.style.transform = 'scale(1)';
                }, 50);
                toggleIcon.classList.add('is-minus');
                toggleBtn.setAttribute('aria-label', 'Hide IBKR CSV import form');
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

    // Show/hide conditional fields based on event type
    function updateConditionalFields() {
        const typeSelect = document.getElementById('txn_type');
        if (!typeSelect) return;
        const type = typeSelect.value;
        // Rules:
        // - Always show: Broker, Date, Event type, Currency, Net Amount, Notes
        // - Ticker/Quantity: only buy/sell (dividend/foreign_tax_withholding already have amount, no need quantity/price)
        // - Price: only buy/sell
        // - Commission: only buy/sell/dividend_reinvestment
        const needTicker = ['buy', 'sell'].includes(type);
        const needQuantity = ['buy', 'sell'].includes(type);
        const needPrice = ['buy', 'sell'].includes(type);
        const needCommission = ['buy', 'sell', 'dividend_reinvestment'].includes(type);
        const tickerRow = document.getElementById('txn_ticker_row');
        const quantityRow = document.getElementById('txn_quantity_row');
        const priceRow = document.getElementById('txn_price_row');
        const commissionRow = document.getElementById('txn_commission_row');
        if (tickerRow) tickerRow.style.display = needTicker ? 'block' : 'none';
        if (quantityRow) quantityRow.style.display = needQuantity ? 'block' : 'none';
        if (priceRow) priceRow.style.display = needPrice ? 'block' : 'none';
        if (commissionRow) commissionRow.style.display = needCommission ? 'block' : 'none';
    }

    // Auto-calculate net amount based on type, quantity, price, commission
    function calculateNetAmount() {
        const typeEl = document.getElementById('txn_type');
        const quantityEl = document.getElementById('txn_quantity');
        const priceEl = document.getElementById('txn_price');
        const commissionEl = document.getElementById('txn_commission');
        const amountEl = document.getElementById('txn_amount');

        if (!typeEl || !quantityEl || !priceEl || !commissionEl || !amountEl) return;

        const selectedType = typeEl.value;
        const quantity = parseFloat(quantityEl.value || 0);
        const price = parseFloat(priceEl.value || 0);
        const commission = parseFloat(commissionEl.value || 0);

        if (!isNaN(quantity) && !isNaN(price) && quantity > 0 && price > 0) {
            let gross = quantity * price;
            let net = gross + commission; // Buy: you spend more due to commission
            if (selectedType === 'sell') {
                net = gross - commission; // Sell: you receive less due to commission
            }
            amountEl.value = net.toFixed(2);
        }
    }

    // Attach auto-calculate to input events
    ['txn_quantity', 'txn_price', 'txn_commission', 'txn_type'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', calculateNetAmount);
            el.addEventListener('change', calculateNetAmount);
        }
    });

    // Format date from picker to YYYY-MM-DD 20:00:00 (EOD)
    function getFormattedDate() {
        const dateInput = document.getElementById('txn_date');
        if (!dateInput || !dateInput.value) {
            const today = new Date();
            return `${today.toISOString().slice(0, 10)} 20:00:00`;
        }

        // If date picker populated with D MMM YYYY format, parse it
        const value = dateInput.value.trim();
        let dateStr;
        const match = value.match(/^(\d{1,2}) (\w{3}) (\d{4})$/);
        if (match) {
            const [_, day, mon, year] = match;
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const monthIndex = months.findIndex(m => m.toLowerCase() === mon.toLowerCase());
            const dateObj = new Date(parseInt(year), monthIndex, parseInt(day));
            dateStr = dateObj.toISOString().slice(0, 10);
        } else {
            // Try direct parsing
            const parsed = new Date(value);
            if (!isNaN(parsed.getTime())) {
                dateStr = parsed.toISOString().slice(0, 10);
            } else {
                const today = new Date();
                dateStr = today.toISOString().slice(0, 10);
            }
        }

        // Always default to 20:00:00 for end-of-day transactions
        return `${dateStr} 20:00:00`;
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
                setImportFeedback('Please choose both IBKR CSV files before importing.', true);
                return;
            }
            if (!isLikelyTransactionHistoryFile(transactionsFile) || !isLikelyPositionsFile(positionsFile)) {
                setImportFeedback('Please make sure the first file is your Transaction History CSV and the second file is your Realized Summary CSV.', true);
                return;
            }

            const formData = new FormData();
            formData.append('transactions_csv', transactionsFile);
            formData.append('positions_csv', positionsFile);

            const submitButton = investmentForm.querySelector('button[type="submit"]');
            if (submitButton) {
                submitButton.disabled = true;
            }
            fetch('/api/investment/transactions', {
                method: 'POST',
                body: formData,
            })
            .then(response => response.json())
            .then(result => {
                if (result.success) {
                    setImportFeedback(result.message || 'Import complete.');
                    window.location.reload();
                } else {
                    setImportFeedback(result.error || 'Import failed.', true);
                }
            })
            .catch(err => {
                setImportFeedback(`Network error: ${err.message}`, true);
            })
            .finally(() => {
                if (submitButton) {
                    submitButton.disabled = false;
                }
            });
        });
    }

    // Load and render transactions
    fetch('/api/investment/transactions')
        .then(response => response.json())
        .then(async data => {
            // Save top-level data to global for starting_cash
            window.ANTIGRAVITY_INVESTMENT_DATA = data;
            await renderTransactionTable(data.transactions || []);
        })
        .catch(err => {
            console.error('Failed to load transactions:', err);
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

    function getMoneyMarketTickerSet() {
        const configuredTickers = window.ANTIGRAVITY_INVESTMENT_DATA?.money_market_tickers || [];
        return new Set(
            configuredTickers
                .map((ticker) => String(ticker || '').trim().toUpperCase())
                .filter(Boolean)
        );
    }

    function buildTickerSummaries(transactions, latestPrices, totalEquity) {
        const tickerMap = new Map();
        const orderedTransactions = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

        orderedTransactions.forEach((txn) => {
            if (!shouldTrackHoldingTicker(txn)) return;
            const ticker = String(txn.ticker).trim().toUpperCase();
            const normalizedType = getNormalizedTransactionType(txn);
            const quantity = getTransactionQuantity(txn);
            const amount = getTransactionAmount(txn);

            if (!tickerMap.has(ticker)) {
                tickerMap.set(ticker, {
                    ticker,
                    shares: 0,
                    totalCost: 0,
                    realizedPnl: 0,
                });
            }

            const summary = tickerMap.get(ticker);

            if (normalizedType === 'buy' && quantity !== null && !Number.isNaN(quantity)) {
                summary.shares += quantity;
                summary.totalCost += Math.abs(amount);
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
                const averagePrice = summary.shares > 0 ? summary.totalCost / summary.shares : 0;
                summary.realizedPnl += amount - (averagePrice * quantity);
                summary.totalCost -= averagePrice * quantity;
                summary.shares -= quantity;
                if (Math.abs(summary.shares) < 1e-9) {
                    summary.shares = 0;
                    summary.totalCost = 0;
                }
                return;
            }

            if (['dividend', 'foreign_tax_withholding', 'payment_in_lieu', 'adjustment'].includes(normalizedType)) {
                summary.realizedPnl += amount;
            }
        });

        return Array.from(tickerMap.values()).map((summary) => {
            const hasOpenPosition = summary.shares > 0;
            const averagePrice = hasOpenPosition ? (summary.totalCost / summary.shares) : null;
            const lastPrice = latestPrices[summary.ticker] ?? null;
            const marketValue = hasOpenPosition && lastPrice !== null ? summary.shares * lastPrice : 0;
            const unrealizedPnl = hasOpenPosition && lastPrice !== null && averagePrice !== null
                ? (lastPrice - averagePrice) * summary.shares
                : null;
            const positionWeight = totalEquity > 0 && marketValue > 0 ? (marketValue / totalEquity) * 100 : 0;

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
                return right.marketValue - left.marketValue;
            }
            return left.ticker.localeCompare(right.ticker);
        });
    }

    function renderHoldingsTable(summaries, tickerProfiles, totalEquity, totalCash) {
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
        const totalWeight = totalEquity > 0 ? Math.max(0, (1 - ((Number(totalCash) || 0) / totalEquity)) * 100) : 0;
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
                <tr>
                    <td class="investment-holdings-cell investment-holdings-cell-center">${index + 1}</td>
                    <td class="investment-holdings-cell investment-holdings-cell-ticker">
                        <a href="/more/timing?ticker=${encodeURIComponent(summary.ticker)}" class="suggestion-item timing-suggestion-item investment-holdings-ticker-link" data-ticker="${escapeHtml(summary.ticker)}">
                            ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="" class="timing-suggestion-logo investment-holdings-ticker-logo" loading="lazy" decoding="async">` : `<span class="investment-holdings-ticker-logo-placeholder" aria-hidden="true"></span>`}
                            <span class="timing-suggestion-copy investment-holdings-ticker-copy">
                                <span class="suggestion-symbol timing-suggestion-symbol investment-holdings-ticker-symbol">${escapeHtml(summary.ticker)}</span>
                                <span class="suggestion-name timing-suggestion-name investment-holdings-ticker-name" title="${escapeHtml(companyName)}">${escapeHtml(companyName)}</span>
                            </span>
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
                            <th>Realiszed P&amp;L</th>
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

    async function renderTransactionTable(transactions) {
        const tbody = document.getElementById('investment_history');
        if (!tbody) return;

        if (!transactions.length) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--muted);">No transactions yet. Click + above to import your IBKR CSV files.</td></tr>`;
            return;
        }

        // 1. Sort by date ascending to calculate running cash and holdings
        // Read starting_cash from top-level JSON if available, otherwise default to 0
        let runningCash = getInvestmentStartingCash();
        const holdings = {}; // {ticker: quantity}
        const tickers = new Set();
        const moneyMarketTickers = getMoneyMarketTickerSet();
        const moneyMarketAnchors = {}; // {ticker: weightedAveragePrice}

        const processed = transactions.sort((a, b) => new Date(a.date) - new Date(b.date)).map(txn => {
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
                        delete holdings[txn.ticker];
                        delete moneyMarketAnchors[txn.ticker];
                    }
                }
            }

            if (shouldTrackHoldingTicker(txn)) {
                tickers.add(String(txn.ticker).trim().toUpperCase());
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
                running_cash: runningCash,
                display_amount: getTransactionEconomicAmount(txn),
                holdings: { ...holdings },
                money_market_anchors: { ...moneyMarketAnchors },
            };
        });

        // 2. Load {TICKER}.parquet files and get close prices for all transaction dates
        const tickerClosePrices = {}; // {ticker: {dateString: closePrice}}
        await Promise.all(Array.from(tickers).map(async ticker => {
            try {
                const response = await fetch(`/api/investment/parquet?ticker=${ticker}`);
                const data = await response.json();
                if (data.success && data.prices) {
                    // Create a map: date string (YYYY-MM-DD) -> close price
                    tickerClosePrices[ticker] = {};
                    data.prices.forEach(item => {
                        tickerClosePrices[ticker][item.date] = item.close;
                    });
                }
            } catch (err) {
                console.warn(`Failed to load parquet data for ${ticker}:`, err);
            }
        }));

        // Get latest price from parquet (last available close) for final valuation
        const latestPrices = {};
        Object.entries(tickerClosePrices).forEach(([ticker, dateMap]) => {
            const dates = Object.keys(dateMap).sort();
            if (dates.length > 0) {
                latestPrices[ticker] = dateMap[dates[dates.length - 1]];
            }
        });

        // 3. For each transaction, get the closest available close price on or before the transaction date
        //    and calculate total equity = cash + sum(holdings * historical close price)
        processed.forEach((txn) => {
            let marketValue = 0;
            Object.entries(txn.holdings).forEach(([ticker, quantity]) => {
                let closePrice = 0;
                const normalizedTicker = String(ticker).trim().toUpperCase();
                const isMoneyMarketTicker = moneyMarketTickers.has(normalizedTicker);
                if (tickerClosePrices[ticker]) {
                    // Find the latest date in parquet that is <= transaction date
                    const txnDate = txn.date; // YYYY-MM-DD
                    const availableDates = Object.keys(tickerClosePrices[ticker]).filter(d => d <= txnDate).sort();
                    if (availableDates.length > 0) {
                        const closestDate = availableDates[availableDates.length - 1];
                        closePrice = tickerClosePrices[ticker][closestDate];
                    }
                }
                if (isMoneyMarketTicker) {
                    const sameDaySellPrice = normalizedTicker === String(txn.ticker || '').trim().toUpperCase()
                        && getNormalizedTransactionType(txn) === 'sell'
                        ? getTransactionPrice(txn)
                        : null;
                    const anchoredPrice = txn.money_market_anchors?.[ticker] ?? txn.money_market_anchors?.[normalizedTicker];
                    closePrice = sameDaySellPrice ?? anchoredPrice ?? closePrice;
                }
                // Fallback: if no historical data, use txn.price if available, otherwise 0
                if (closePrice === 0 && txn.ticker === ticker && txn.price) {
                    closePrice = txn.price;
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

        // 4. Render reverse chronological (newest first)
        tbody.innerHTML = [...processed].reverse().map((txn, index) => {
            // Format description: for transactions with ticker & quantity, use TICKER@quantity format
            let description;
            // Get quantity: check top-level first, then quantity_abs, then normalized.display_quantity (IBKR imported format)
            let qty = txn.quantity ?? txn.quantity_abs ?? txn.normalized?.display_quantity;
            // Get price: check normalized.unit_price first then top-level
            const price = txn.normalized?.unit_price ?? txn.price;
            // Normalize type for checking buy/sell (already normalized in processing, but keep for safety)
            const normalizedTypeDesc = txn.type.replace(/\s+/g, '_').toLowerCase();
            if (txn.ticker && qty) {
                // Remove trailing .0 if integer for cleaner display
                const cleanQty = Number.isInteger(Number(qty)) ? String(parseInt(qty)) : qty;
                // For buy/sell, format as "TICKER @ PRICE × QTY"
                if (price && ['buy', 'sell', 'grant'].includes(normalizedTypeDesc)) {
                    // Format price to 2 decimal places
                    const cleanPrice = Number(price).toFixed(2);
                    description = `${txn.ticker} @ ${cleanPrice} × ${cleanQty}`;
                } else {
                    // For other types (dividend reinvestment, etc.), keep original TICKER@QTY format
                    description = `${txn.ticker}@${cleanQty}`;
                }
            } else if (txn.type === 'deposit' || txn.type === 'withdrawal') {
                description = '';
            } else {
                description = txn.description || '--';
            }

            // Format time: if time is exactly 20:00:00 (EOD), hide it to show only date
            let formattedTime = txn.date ? txn.date.replace(/-/g, '/') : '';
            if (formattedTime.includes(' ') && formattedTime.endsWith('20:00:00')) {
                formattedTime = formattedTime.split(' ')[0];
            }

            // Show '-' instead of 0.00 for commission on types that don't normally have commission
            const normalizedType = txn.type.replace(/\s+/g, '_').toLowerCase();
            const noCommissionTypes = [
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
                'withdrawal'
            ];
            let commissionDisplay;
            // Get commission from normalized.commission if available (IBKR imported format), otherwise top-level
            const commission = txn.normalized?.commission ?? txn.commission ?? 0;
            if ((!commission || commission === 0) && noCommissionTypes.includes(normalizedType)) {
                commissionDisplay = '-';
            } else {
                commissionDisplay = formatAmount(Math.abs(commission));
            }

            return `
            <tr>
                <td style="text-align: center; padding: 2px 1px;">${transactions.length - index}</td>
                <td style="text-align: right; padding: 2px 1px;">${formattedTime}</td>
                <td style="text-align: center; padding: 2px 1px;">${formatEventType(txn.type)}</td>
                <td style="text-align: left; padding: 2px 1px;">${description}</td>
                <td style="text-align: center; padding: 2px 1px;">${txn.currency || 'USD'}</td>
                <td style="text-align: right; padding: 2px 1px;">${formatAmount(txn.display_amount)}</td>
                <td style="text-align: right; padding: 2px 1px;">${commissionDisplay}</td>
                <td style="text-align: right; padding: 2px 1px;">${formatAmount(txn.market_value)}</td>
                <td style="text-align: right; padding: 2px 1px;">${formatAmount(txn.running_cash)}</td>
                <td style="text-align: right; padding: 2px 1px;"><strong>${formatAmount(txn.total_equity)}</strong></td>
            </tr>
            `;
        }).join('');

        // 5. Update dashboard with latest total equity
        updateDashboardWithEquity(processed, latestSnapshot, latestPrices, tickerClosePrices, transactions);
    }

    function updateDashboardWithEquity(processed, latestSnapshot, latestPrices, tickerClosePrices, rawTransactions) {
        const last = latestSnapshot || processed[processed.length - 1];
        if (!last) return;

        const holdingsPanel = document.getElementById('investment_holdings_panel');
        const metricsPanel = document.getElementById('investment_metrics_panel');
        if (!holdingsPanel || !metricsPanel) return;
        const shouldAnimateVisibleMetricsPanel = activeInvestmentView === 'holdings' || activeInvestmentView === 'metrics';
        if (shouldAnimateVisibleMetricsPanel) {
            lockInvestmentSurfaceHeight();
        }

        // Get all original transactions from the processed array (processed is sorted ascending, contains all transactions)
        const originalTransactions = processed.map(p => ({date: p.date, type: p.type, amount: p.amount}));
        const totalDeposits = getTotalDeposits(originalTransactions);
        const netProfit = last.total_equity - totalDeposits;
        const isPositive = netProfit >= 0;

        const tickerProfiles = window.ANTIGRAVITY_INVESTMENT_DATA?.ticker_profiles || {};
        const tickerSummaries = buildTickerSummaries(rawTransactions, latestPrices, last.total_equity);
        holdingsPanel.innerHTML = renderHoldingsTable(tickerSummaries, tickerProfiles, last.total_equity, last.running_cash);
        syncHoldingsStickyOffset(holdingsPanel);

        metricsPanel.innerHTML = `
            <div class="trade-metric-card">
                <span class="trade-metric-label">Current Cash</span>
                <span class="trade-metric-value" data-workspace-mask="trade-metric">${formatAmount(last.running_cash)}</span>
            </div>
            <div class="trade-metric-card">
                <span class="trade-metric-label">Total Equity</span>
                <span class="trade-metric-value" data-workspace-mask="trade-metric">${formatAmount(last.total_equity)}</span>
            </div>
            <div class="trade-metric-card">
                <span class="trade-metric-label">Net Profit/Loss</span>
                <span class="trade-metric-value" data-workspace-mask="trade-metric" style="color: ${isPositive ? 'var(--accent-positive)' : 'var(--error)'};">
                    ${isPositive ? '+' : ''}${formatAmount(Math.abs(netProfit))}
                </span>
            </div>
            <div class="trade-metric-card">
                <span class="trade-metric-label">Total Transactions</span>
                <span class="trade-metric-value" data-workspace-mask="trade-metric">${processed.length}</span>
            </div>
        `;
        if (shouldAnimateVisibleMetricsPanel) {
            animateInvestmentSurfaceHeight();
        }
        renderEquityChartWithEquity(processed, tickerClosePrices);
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
    function renderEquityChartWithEquity(transactions, tickerClosePrices) {
        if (!transactions.length || !window.Chart) {
            console.warn('Chart.js not available');
            return;
        }

        const container = document.getElementById('investment_equity_chart');
        if (!container) {
            console.warn('Chart container not found');
            return;
        }

        // Clear any existing chart
        container.innerHTML = `<canvas id="investmentEquityChart"></canvas>`;
        const canvas = document.getElementById('investmentEquityChart');
        const existingChart = window.Chart.getChart?.(canvas);
        if (existingChart) existingChart.destroy();

        const points = [];
        const rawDates = [];

        const sortedTransactions = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

        sortedTransactions.forEach(txn => {
            points.push(txn.total_equity);
            rawDates.push(txn.date);
        });

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
        const equitySeriesColor = "#0055cc";

        const initialDeposits = getTotalDeposits(sortedTransactions);
        const labels = [...rawDates];
        const equity = [...points];
        const fixedYAxisWidth = 52;
        const monthAbbreviations = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

        const referenceLinePlugin = {
            id: "investmentReferenceLine",
            beforeDatasetsDraw(chart) {
                if (!Number.isFinite(initialDeposits) || initialDeposits <= 0) return;
                const { ctx, chartArea, scales } = chart;
                const yScale = scales?.y;
                if (!chartArea || !yScale) return;
                const y = yScale.getPixelForValue(initialDeposits);
                if (!Number.isFinite(y) || y < chartArea.top || y > chartArea.bottom) return;
                ctx.save();
                ctx.strokeStyle = resolvedTheme.muted;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(chartArea.left + 8, y);
                ctx.lineTo(chartArea.right - 8, y);
                ctx.stroke();
                ctx.restore();
            },
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
        const axisLineColor = resolvedTheme.muted;
        const getOrCreateTooltip = (chart) => {
            const parent = chart.canvas.parentNode;
            let tooltip = parent.querySelector(".chart-tooltip");
            if (tooltip) return tooltip;
            tooltip = document.createElement("div");
            tooltip.className = "chart-tooltip";
            tooltip.innerHTML = '<p class="chart-tooltip-date"></p><div class="chart-tooltip-list"></div>';
            parent.appendChild(tooltip);
            return tooltip;
        };

        const formatTooltipDate = (dateParts) => `${dateParts.day} ${monthAbbreviations[dateParts.monthIndex]} ${dateParts.year}`;

        const externalTooltipHandler = ({ chart, tooltip }) => {
            const tooltipEl = getOrCreateTooltip(chart);
            if (tooltip.opacity === 0) {
                tooltipEl.classList.remove("is-visible");
                return;
            }

            const dateEl = tooltipEl.querySelector(".chart-tooltip-date");
            const listEl = tooltipEl.querySelector(".chart-tooltip-list");
            const pointIndex = tooltip.dataPoints?.[0]?.dataIndex ?? -1;
            const parsedDate = parseRawDate(rawDates[pointIndex]);
            const pointRecord = sortedTransactions[pointIndex];
            dateEl.textContent = parsedDate ? formatTooltipDate(parsedDate) : (tooltip.title?.[0] || "");

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

            const parentRect = chart.canvas.parentNode.getBoundingClientRect();
            const tooltipRect = tooltipEl.getBoundingClientRect();
            const padding = 12;
            const gap = 14;
            const anchorX = chart.canvas.offsetLeft + tooltip.caretX;
            const anchorY = chart.canvas.offsetTop + tooltip.caretY;
            const roomRight = parentRect.width - anchorX - padding;
            const roomLeft = anchorX - padding;
            const preferRight = roomRight >= tooltipRect.width + gap || roomRight >= roomLeft;
            let left = preferRight ? anchorX + gap : anchorX - tooltipRect.width - gap;
            if (left < padding) left = padding;
            if (left + tooltipRect.width > parentRect.width - padding) {
                left = parentRect.width - tooltipRect.width - padding;
            }
            let top = anchorY - (tooltipRect.height / 2);
            if (top < padding) top = padding;
            if (top + tooltipRect.height > parentRect.height - padding) {
                top = parentRect.height - tooltipRect.height - padding;
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

        new Chart(canvas, {
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
                scales: {
                    ...commonOptions.scales,
                    x: { ...commonOptions.scales.x, display: false },
                    y: { ...commonOptions.scales.y, ...equityYScale },
                },
            },
            plugins: [referenceLinePlugin, hoverGuidePlugin, xAxisLabelPlugin],
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

    function renderEquityChart(transactions) {
        if (!transactions.length) return;

        // Prepare data for cumulative cash chart
        // Read starting_cash from top-level JSON if available
        let runningCash = getInvestmentStartingCash();
        const points = transactions.sort((a, b) => new Date(a.date) - new Date(b.date)).map(txn => {
            // Read amount from normalized.net_amount if available (IBKR imported format), otherwise fall back to top-level
            let amount = (txn.normalized?.net_amount ?? txn.amount ?? txn.cash) || 0;

            // Auto-calculate amount if missing
            if (!amount && txn.quantity && txn.price && (txn.type === 'buy' || txn.type === 'sell')) {
                amount = txn.quantity * txn.price;
            }

            const commission = txn.commission || 0;

            if (txn.type === 'deposit' || txn.type === 'sell' || txn.type === 'dividend' || txn.type === 'credit_interest') {
                if (txn.type === 'sell' && amount && commission) {
                    runningCash += (amount - commission);
                } else {
                    runningCash += amount;
                }
            } else if (txn.type === 'withdrawal' || txn.type === 'buy' || txn.type === 'dividend_reinvestment' || txn.type === 'tax_withholding' || txn.type === 'debit_interest') {
                if (txn.type === 'buy' && amount && commission) {
                    runningCash -= (amount + commission);
                } else {
                    runningCash -= Math.abs(amount);
                }
            } else {
                runningCash += amount;
            }

            // Commission already accounted for buy/sell
            if (txn.commission && !['buy', 'sell'].includes(txn.type)) {
                runningCash -= Math.abs(commission);
            }

            return {
                date: new Date(txn.date),
                cash: runningCash,
            };
        });

        // Use the same chart drawing infrastructure as the rest of the app
        const container = document.getElementById('investment_equity_chart');
        if (!container || typeof drawLineChart !== 'function') {
            console.warn('Chart drawing not available');
            return;
        }

        const colors = getComputedStyle(document.documentElement);
        const accentColor = colors.getPropertyValue('--accent-fill').trim() || '#0055cc';

        const chartData = {
            labels: points.map(p => p.date.toLocaleDateString()),
            series: [{
                name: 'Cash Balance',
                values: points.map(p => p.cash),
                color: accentColor,
            }],
        };

        // Clear any existing content
        container.innerHTML = '';

        // Draw the chart using the global chart helper from base.html
        try {
            window.drawLineChart(container, chartData, {
                yAxisFormatter: (value) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                tooltipFormatter: (value) => `$${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
            });
        } catch (err) {
            console.error('Failed to draw chart', err);
        }

        // Update dashboard summary
        updateDashboard(points[points.length - 1]?.cash || 0);
    }

    function getTotalDeposits(transactions) {
        return transactions.filter(t => t.type === 'deposit').reduce((sum, t) => sum + (t.amount || 0), 0);
    }
});
