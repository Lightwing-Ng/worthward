/**
 * Share-card capture and linked-hover interactions.
 *
 * Code version: v1.0.0
 * - Added: Extracted from the Investment workspace composition root.
 */

export function createInvestmentShareLinkedHoverRuntime(runtime) {
function getInvestmentShareViewTitle(view = runtime.state.activeInvestmentView) {
        return getInvestmentShareViewLabel(view);
    }

function getInvestmentShareViewLabel(view = runtime.state.activeInvestmentView) {
        switch (runtime.normalizeInvestmentView(view)) {
            case 'holdings':
                return 'Holdings';
            case 'stock_details':
                return 'Stock details';
            case 'metrics':
                return 'Metrics';
            case 'chart':
            default:
                return 'Overview';
        }
    }

function getInvestmentShareViewSubtitle(view = runtime.state.activeInvestmentView) {
        void view;
        return '';
    }

function getInvestmentProjectMeta() {
        const sourceUrl = String(window.WORTHWARD_APP?.project?.sourceUrl || '').trim();
        const displayUrl = String(window.WORTHWARD_APP?.project?.displayUrl || '').trim();
        return {
            sourceUrl: sourceUrl || window.location.href,
            displayUrl: displayUrl || sourceUrl.replace(/^https?:\/\//, '') || window.location.host,
        };
    }

function getInvestmentShareTimestampText() {
        const formatter = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Hong_Kong',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
        });
        const parts = Object.create(null);
        formatter.formatToParts(new Date()).forEach((part) => {
            if (part.type !== 'literal') parts[part.type] = part.value;
        });
        return `${parts.day}/${parts.month}/${parts.year}\n${parts.hour}:${parts.minute}:${parts.second} HKT`;
    }

function sanitizeInvestmentShareClone(node) {
        if (!(node instanceof HTMLElement)) return node;
        node.querySelectorAll('[id]').forEach((element) => {
            element.removeAttribute('id');
        });
        node.querySelectorAll('[data-bound], [data-history-hover-bound], [data-logo-fallback-bound]').forEach((element) => {
            element.removeAttribute('data-bound');
            element.removeAttribute('data-history-hover-bound');
            element.removeAttribute('data-logo-fallback-bound');
        });
        return node;
    }

function createInvestmentShareHeader(view = runtime.state.activeInvestmentView) {
        const header = document.createElement('div');
        header.className = 'investment-community-share-header';

        const heading = document.createElement('div');
        heading.className = 'investment-community-share-heading';

        const title = document.createElement('p');
        title.className = 'investment-community-share-title';
        title.textContent = getInvestmentShareViewTitle(view);
        heading.appendChild(title);

        const subtitleText = getInvestmentShareViewSubtitle(view);
        if (subtitleText && runtime.normalizeInvestmentView(view) !== 'chart') {
            const subtitle = document.createElement('p');
            subtitle.className = 'investment-community-share-subtitle';
            subtitle.textContent = subtitleText;
            heading.appendChild(subtitle);
        }

        header.appendChild(heading);
        return header;
    }

async function ensureInvestmentQrCodeFactory() {
        if (typeof window.qrcode === 'function') return window.qrcode;
        if (runtime.state.investmentQrCodeLibraryPromise) return runtime.state.investmentQrCodeLibraryPromise;
        runtime.state.investmentQrCodeLibraryPromise = new Promise((resolve, reject) => {
            const existingScript = document.querySelector('script[data-investment-share-library="qrcode-generator"]');
            if (existingScript) {
                existingScript.addEventListener('load', () => resolve(window.qrcode), { once: true });
                existingScript.addEventListener('error', () => reject(new Error('Failed to load QR code renderer.')), { once: true });
                return;
            }
            const script = document.createElement('script');
            script.src = '/static/assets/js/vendor/qrcode-generator.js';
            script.async = true;
            script.dataset.investmentShareLibrary = 'qrcode-generator';
            script.addEventListener('load', () => {
                if (typeof window.qrcode === 'function') {
                    resolve(window.qrcode);
                    return;
                }
                reject(new Error('QR code renderer loaded without exposing factory.'));
            }, { once: true });
            script.addEventListener('error', () => {
                reject(new Error('Failed to load QR code renderer.'));
            }, { once: true });
            document.head.appendChild(script);
        }).catch((error) => {
            runtime.state.investmentQrCodeLibraryPromise = null;
            throw error;
        });
        return runtime.state.investmentQrCodeLibraryPromise;
    }

async function createInvestmentShareQrNode(sourceUrl) {
        const qrFactory = await ensureInvestmentQrCodeFactory();
        const qr = qrFactory(0, 'M');
        qr.addData(String(sourceUrl || '').trim());
        qr.make();
        const moduleCount = qr.getModuleCount();
        const margin = 2;
        const viewBoxSize = moduleCount + margin * 2;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${viewBoxSize} ${viewBoxSize}`);
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');

        const pathData = [];
        for (let row = 0; row < moduleCount; row += 1) {
            for (let col = 0; col < moduleCount; col += 1) {
                if (!qr.isDark(row, col)) continue;
                const x = col + margin;
                const y = row + margin;
                pathData.push(`M${x} ${y}h1v1H${x}z`);
            }
        }

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData.join(''));
        path.setAttribute('fill', 'currentColor');
        svg.appendChild(path);
        return svg;
    }

async function createInvestmentShareFooter() {
        const projectMeta = getInvestmentProjectMeta();
        const footer = document.createElement('div');
        footer.className = 'investment-community-share-footer';
        footer.dataset.shareTemplateFixed = '1';

        const brandIcon = document.createElement('img');
        brandIcon.className = 'investment-community-share-footer-brand-icon';
        brandIcon.src = '/market-store/logos/favicon.svg';
        brandIcon.alt = '';
        brandIcon.decoding = 'sync';
        footer.appendChild(brandIcon);

        const copy = document.createElement('div');
        copy.className = 'investment-community-share-footer-copy';

        const timestamp = document.createElement('div');
        timestamp.className = 'investment-community-share-footer-timestamp';
        timestamp.textContent = getInvestmentShareTimestampText();

        copy.appendChild(timestamp);

        const prompt = document.createElement('p');
        prompt.className = 'investment-community-share-footer-prompt';
        prompt.textContent = runtime.INVESTMENT_COMMUNITY_SHARE_FOOTER_PROMPT;
        copy.appendChild(prompt);

        footer.appendChild(copy);

        const qrShell = document.createElement('div');
        qrShell.className = 'investment-community-share-footer-qr';
        qrShell.appendChild(await createInvestmentShareQrNode(projectMeta.sourceUrl));
        footer.appendChild(qrShell);
        return footer;
    }

function createInvestmentShareTemplateFrame(view = runtime.state.activeInvestmentView) {
        const normalizedView = runtime.normalizeInvestmentView(view);
        const host = document.createElement('div');
        host.className = 'investment-community-share-capture';
        host.style.setProperty('--investment-community-share-shell-export-width', 'var(--investment-community-share-shell-width, 1080px)');
        host.style.setProperty('--investment-community-share-shell-export-height', 'var(--investment-community-share-shell-height, 1730px)');

        const card = document.createElement('article');
        card.className = 'investment-community-share-card';
        card.dataset.shareView = normalizedView;
        card.dataset.shareTemplate = 'stable-v1';

        const body = document.createElement('div');
        body.className = 'investment-community-share-body';

        card.appendChild(createInvestmentShareHeader(normalizedView));
        card.appendChild(body);
        const exportImageConfig = window.WORTHWARD_EXPORT_IMAGE;
        const profileId = exportImageConfig?.defaultProfileId || 'investment-community-share';
        if (typeof exportImageConfig?.applyConfigToTargets === 'function') {
            exportImageConfig.applyConfigToTargets([host, card], profileId);
        }
        host.appendChild(card);
        return { host, card, body };
    }

function createInvestmentShareSection(className = '') {
        const section = document.createElement('div');
        section.className = ['investment-community-share-section', className].filter(Boolean).join(' ');
        return section;
    }

function readInvestmentShareSafePaddingPx(scope = document.documentElement) {
        const readFromBootstrap = window.WORTHWARD_BOOTSTRAP?.workspaceShare?.readSafePaddingPx;
        if (typeof readFromBootstrap === 'function') {
            return readFromBootstrap(scope);
        }
        const element = scope instanceof HTMLElement ? scope : document.documentElement;
        const styles = window.getComputedStyle(element);
        const raw = styles.getPropertyValue('--investment-community-share-safe-padding').trim()
            || styles.getPropertyValue('--investment-community-share-card-padding').trim()
            || '10px';
        const value = Number.parseFloat(raw);
        return Number.isFinite(value) ? value : 10;
    }

function resolveInvestmentShareChartInstance(canvas) {
        if (!(canvas instanceof HTMLCanvasElement)) return null;
        if (canvas.id === 'investmentEquityChart') return runtime.state.investmentEquityChartInstance;
        if (canvas.classList.contains('investment-stock-details-price-chart-canvas')) {
            return runtime.state.investmentStockDetailsPriceChartInstance;
        }
        return window.Chart?.getChart?.(canvas) || null;
    }

function createInvestmentShareChartDataUrl(canvas) {
        if (!(canvas instanceof HTMLCanvasElement)) return null;
        const capture = window.WORTHWARD_BOOTSTRAP?.workspaceShare?.captureChartDataUrl;
        const chartInstance = resolveInvestmentShareChartInstance(canvas);
        if (typeof capture === 'function') {
            return capture(canvas, chartInstance) || canvas.toDataURL('image/png');
        }
        return canvas.toDataURL('image/png');
    }

function createInvestmentShareChartImage(canvas) {
        const chartDataUrl = createInvestmentShareChartDataUrl(canvas);
        if (!chartDataUrl) return null;
        const image = document.createElement('img');
        image.className = 'investment-community-share-chart-image';
        image.alt = '';
        image.decoding = 'sync';
        image.src = chartDataUrl;
        return image;
    }

function createInvestmentShareChartSection(canvas) {
        const image = createInvestmentShareChartImage(canvas);
        if (!(image instanceof HTMLImageElement)) return null;
        const section = createInvestmentShareSection('investment-community-share-section--chart');
        const shell = document.createElement('div');
        shell.className = 'investment-community-share-chart-shell';
        shell.appendChild(image);
        section.appendChild(shell);
        return section;
    }

function buildInvestmentOverviewShareBody(body) {
        const chartCanvas = document.getElementById('investmentEquityChart');
        runtime.syncInvestmentEquityChartAxisMask();
        const chartSection = createInvestmentShareChartSection(chartCanvas);
        if (!(chartSection instanceof HTMLElement)) return false;
        body.appendChild(chartSection);

        const donutShell = runtime.investmentDummyChart?.querySelector('.style-token-portfolio-donut-shell');
        if (donutShell instanceof HTMLElement) {
            const donutSection = createInvestmentShareSection('investment-community-share-section--compact investment-community-share-section--padded');
            const donutWrap = document.createElement('div');
            donutWrap.className = 'investment-community-share-overview-donut';
            donutWrap.appendChild(sanitizeInvestmentShareClone(donutShell.cloneNode(true)));
            donutSection.appendChild(donutWrap);
            body.appendChild(donutSection);
        }
        return true;
    }

function stabilizeInvestmentShareDonutOrbits(root) {
        if (!(root instanceof HTMLElement)) return;
        root.querySelectorAll('.style-token-portfolio-donut-orbit').forEach((orbitElement) => {
            if (!(orbitElement instanceof HTMLElement)) return;
            const orbitMetrics = runtime.getPortfolioDonutOrbitMetrics(orbitElement);
            if (!orbitMetrics) return;
            orbitElement.querySelectorAll('.portfolio-donut-logo[data-style-token-donut-angle]').forEach((logoElement) => {
                if (!(logoElement instanceof HTMLImageElement)) return;
                const targetAngle = Number.parseFloat(logoElement.dataset.styleTokenDonutAngle || '');
                if (!Number.isFinite(targetAngle)) return;
                logoElement.classList.remove('is-orbit-animated', 'is-exiting');
                logoElement.style.transition = 'none';
                runtime.renderInvestmentDonutOrbitLogoPosition(logoElement, targetAngle, orbitMetrics, 1, 1);
            });
        });
    }

function buildInvestmentStockDetailsShareBody(body) {
        if (!(runtime.investmentStockDetailsPanel instanceof HTMLElement)) return false;
        const identity = runtime.investmentStockDetailsPanel.querySelector('.investment-stock-details-identity');
        const chartCanvas = runtime.investmentStockDetailsPanel.querySelector('.investment-stock-details-price-chart-canvas');
        const metrics = runtime.investmentStockDetailsPanel.querySelector('.investment-stock-details-metrics');
        if (!(chartCanvas instanceof HTMLCanvasElement) || !(metrics instanceof HTMLElement)) return false;

        if (identity instanceof HTMLElement) {
            const identitySection = createInvestmentShareSection('investment-community-share-section--compact investment-community-share-section--padded');
            identitySection.appendChild(sanitizeInvestmentShareClone(identity.cloneNode(true)));
            body.appendChild(identitySection);
        }

        const chartSection = createInvestmentShareChartSection(chartCanvas);
        if (chartSection instanceof HTMLElement) {
            body.appendChild(chartSection);
        }

        const metricsSection = createInvestmentShareSection('investment-community-share-section--compact investment-community-share-section--padded');
        metricsSection.appendChild(sanitizeInvestmentShareClone(metrics.cloneNode(true)));
        body.appendChild(metricsSection);
        return true;
    }

function buildInvestmentHoldingsShareTable({ maskSensitive = false } = {}) {
        const headerTable = document.querySelector('#investment_holdings_panel .investment-holdings-table[data-table-header]');
        const bodyTable = document.querySelector('#investment_holdings_panel .investment-holdings-table-scroll table');
        if (!(headerTable instanceof HTMLTableElement) || !(bodyTable instanceof HTMLTableElement)) return null;

        const removedColumnIndexes = maskSensitive ? [7, 5, 3, 1] : [1];
        const pruneShareHoldingsRow = (tableRow) => {
            if (!(tableRow instanceof HTMLTableRowElement)) return;
            removedColumnIndexes.forEach((index) => {
                tableRow.cells.item(index)?.remove();
            });
        };
        const adaptShareHoldingsSummaryRow = (tableRow) => {
            if (!(tableRow instanceof HTMLTableRowElement)) return;
            const summaryCopyCell = tableRow.cells.item(1);
            const summaryLeadCell = tableRow.cells.item(0);
            if (summaryLeadCell instanceof HTMLTableCellElement && summaryCopyCell instanceof HTMLTableCellElement) {
                summaryLeadCell.className = 'investment-holdings-cell investment-holdings-cell-ticker';
                summaryLeadCell.textContent = '';
                Array.from(summaryCopyCell.childNodes).forEach((child) => {
                    summaryLeadCell.appendChild(child);
                });
            }
            pruneShareHoldingsRow(tableRow);
            Array.from(tableRow.cells).forEach((cell, index) => {
                if (!(cell instanceof HTMLTableCellElement)) return;
                if (index === 0 && (cell.querySelector('.investment-holdings-summary-ticker-body') || cell.querySelector('.investment-holdings-summary-copy'))) return;
                runtime.populateShareHoldingsMetricCell(cell);
            });
        };

        const buildShareTickerCell = (ticker) => {
            const normalizedTicker = String(ticker || '').trim().toUpperCase();
            const tickerProfiles = window.WORTHWARD_INVESTMENT_DATA?.ticker_profiles || {};
            const profile = runtime.resolveInvestmentTickerProfile(tickerProfiles, normalizedTicker);
            const tickerLabel = runtime.formatInvestmentTickerForDisplay(normalizedTicker);
            const companyName = runtime.resolveInvestmentTickerCompanyName(tickerProfiles, normalizedTicker);
            const logoUrls = runtime.resolveInvestmentLogoUrls(profile, normalizedTicker);

            const wrapper = document.createElement('div');
            wrapper.className = 'suggestion-item timing-suggestion-item ticker-identity-item investment-holdings-ticker-link';
            wrapper.dataset.ticker = normalizedTicker;

            const row = document.createElement('div');
            row.className = 'ticker-identity-row';

            const logo = document.createElement('img');
            logo.className = 'ticker-identity-logo';
            logo.alt = '';
            logo.hidden = true;
            logo.loading = 'eager';
            logo.decoding = 'async';
            logo.dataset.investmentLogoImage = '';
            logo.dataset.logoUrl = JSON.stringify(logoUrls);
            logo.dataset.ticker = normalizedTicker;

            const placeholder = document.createElement('span');
            placeholder.className = 'ticker-identity-logo ticker-identity-logo-placeholder';
            placeholder.setAttribute('aria-hidden', 'true');

            const copy = document.createElement('span');
            copy.className = 'ticker-identity-copy';

            const symbol = document.createElement('span');
            symbol.className = 'suggestion-symbol ticker-identity-symbol';
            symbol.textContent = tickerLabel;

            copy.appendChild(symbol);
            if (companyName) {
                const name = document.createElement('span');
                name.className = 'suggestion-name ticker-identity-name';
                name.title = companyName;
                name.textContent = companyName;
                copy.appendChild(name);
            }
            row.append(logo, placeholder, copy);
            wrapper.append(row);
            runtime.syncInvestmentTickerLogoAsset(
                logo,
                placeholder,
                logoUrls,
                normalizedTicker ? `${normalizedTicker} logo` : '',
            );
            return wrapper;
        };

        const headerRow = headerTable.querySelector('thead tr:first-child');
        const summaryRow = headerTable.querySelector('.investment-holdings-summary-row');
        const allDataRows = Array.from(bodyTable.querySelectorAll('tbody tr'));
        const brokerRewardsRow = allDataRows.find((row) => row.matches('[data-investment-broker-rewards-row]'));
        const dataRows = allDataRows
            .filter((row) => row !== brokerRewardsRow)
            .slice(0, brokerRewardsRow ? 4 : 5);
        if (brokerRewardsRow) {
            dataRows.push(brokerRewardsRow);
        }
        if (!(headerRow instanceof HTMLTableRowElement) || !dataRows.length) return null;

        const shell = createInvestmentShareSection('investment-community-share-section--chart investment-community-share-table-shell');
        const innerShell = document.createElement('div');
        innerShell.className = 'investment-holdings-table-shell';

        const table = document.createElement('table');
        table.className = 'settings-table trade-transactions-table scrollable-data-table investment-holdings-table investment-community-share-holdings-table';

        const thead = document.createElement('thead');
        const sharedHeaderRow = sanitizeInvestmentShareClone(headerRow.cloneNode(true));
        if (!(sharedHeaderRow instanceof HTMLTableRowElement)) return null;
        pruneShareHoldingsRow(sharedHeaderRow);
        if (summaryRow instanceof HTMLTableRowElement) {
            const sharedSummaryRow = sanitizeInvestmentShareClone(summaryRow.cloneNode(true));
            if (sharedSummaryRow instanceof HTMLTableRowElement) {
                adaptShareHoldingsSummaryRow(sharedSummaryRow);
                thead.appendChild(sharedSummaryRow);
            }
        }
        thead.appendChild(sharedHeaderRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        dataRows.forEach((row) => {
            const sharedRow = sanitizeInvestmentShareClone(row.cloneNode(true));
            if (!(sharedRow instanceof HTMLTableRowElement)) return;
            pruneShareHoldingsRow(sharedRow);
            const tickerCell = sharedRow.cells.item(0);
            if (
                tickerCell instanceof HTMLTableCellElement
                && !sharedRow.matches('[data-investment-broker-rewards-row]')
            ) {
                const ticker = String(sharedRow.dataset.investmentHoldingsTicker || tickerCell.textContent || '').trim();
                tickerCell.textContent = '';
                tickerCell.appendChild(buildShareTickerCell(ticker));
            }
            Array.from(sharedRow.cells).forEach((cell, index) => {
                if (!(cell instanceof HTMLTableCellElement) || index === 0) return;
                runtime.populateShareHoldingsMetricCell(cell);
            });
            tbody.appendChild(sharedRow);
        });
        table.appendChild(tbody);

        innerShell.appendChild(table);
        shell.appendChild(innerShell);
        return shell;
    }

function buildInvestmentHoldingsShareBody(body) {
        const tableShell = buildInvestmentHoldingsShareTable({ maskSensitive: runtime.state.investmentShareMaskEnabled });
        if (!(tableShell instanceof HTMLElement)) return false;
        body.appendChild(tableShell);
        return true;
    }

function buildInvestmentMetricsShareBody(body) {
        const metricsPanel = document.getElementById('investment_metrics_panel');
        if (!(metricsPanel instanceof HTMLElement)) return false;
        const metricsSection = createInvestmentShareSection('investment-community-share-section--chart investment-community-share-section--padded');
        const metricsGrid = sanitizeInvestmentShareClone(metricsPanel.cloneNode(true));
        if (!(metricsGrid instanceof HTMLElement)) return false;
        metricsGrid.classList.add('investment-community-share-metrics-grid');
        body.appendChild(metricsSection);
        metricsSection.appendChild(metricsGrid);
        return true;
    }

async function buildInvestmentCommunityShareCard() {
        const normalizedView = runtime.normalizeInvestmentView(runtime.state.activeInvestmentView);
        const { host, card, body } = createInvestmentShareTemplateFrame(normalizedView);
        if (normalizedView === 'stock_details' && runtime.state.investmentShareMaskEnabled) {
            card.classList.add('is-share-sensitive-masked');
        }

        let rendered = false;
        if (normalizedView === 'stock_details') {
            rendered = buildInvestmentStockDetailsShareBody(body);
        } else if (normalizedView === 'holdings') {
            rendered = buildInvestmentHoldingsShareBody(body);
        } else if (normalizedView === 'metrics') {
            rendered = buildInvestmentMetricsShareBody(body);
        } else {
            rendered = buildInvestmentOverviewShareBody(body);
        }
        if (!rendered) return null;

        card.appendChild(await createInvestmentShareFooter());
        return host;
    }

function buildInvestmentScreenshotFilename() {
        const timestamp = new Date().toISOString().replace(/[:]/g, '-').replace(/\.\d{3}Z$/, 'Z');
        const suffix = runtime.state.activeInvestmentView === 'stock_details'
            ? (runtime.ensureSelectedInvestmentStockTicker() || 'stock-details').toLowerCase()
            : getInvestmentShareViewLabel(runtime.state.activeInvestmentView).toLowerCase().replace(/\s+/g, '-');
        return `investment-${suffix}-${timestamp}.png`;
    }

async function ensureInvestmentScreenshotLibrary() {
        if (window.domtoimage?.toBlob) return window.domtoimage;
        if (runtime.state.investmentScreenshotLibraryPromise) return runtime.state.investmentScreenshotLibraryPromise;
        const loadScript = (src, sourceLabel) => new Promise((resolve, reject) => {
            const existingScript = document.querySelector('script[data-investment-screenshot-library="dom-to-image-more"]');
            if (existingScript && existingScript.src === new URL(src, window.location.href).href) {
                existingScript.addEventListener('load', () => resolve(window.domtoimage), { once: true });
                existingScript.addEventListener('error', () => reject(new Error('Failed to load screenshot library.')), { once: true });
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.dataset.investmentScreenshotLibrary = 'dom-to-image-more';
            script.dataset.investmentScreenshotLibrarySource = sourceLabel;
            script.addEventListener('load', () => {
                if (window.domtoimage?.toBlob) {
                    resolve(window.domtoimage);
                    return;
                }
                reject(new Error('Screenshot library loaded without exposing dom-to-image-more.'));
            }, { once: true });
            script.addEventListener('error', () => {
                reject(new Error('Failed to load screenshot library.'));
            }, { once: true });
            document.head.appendChild(script);
        });
        runtime.state.investmentScreenshotLibraryPromise = loadScript(
            '/static/assets/js/vendor/dom-to-image-more.min.js',
            'local',
        ).catch(() => loadScript(
            'https://cdn.jsdelivr.net/npm/dom-to-image-more@3.6.0/dist/dom-to-image-more.min.js',
            'cdn',
        )).catch((error) => {
            runtime.state.investmentScreenshotLibraryPromise = null;
            throw error;
        });
        return runtime.state.investmentScreenshotLibraryPromise;
    }

function debugInvestmentShareCaptureTiming(label, startedAt) {
        const elapsedMs = Math.round(performance.now() - startedAt);
        console.debug(`[Investment share capture] ${label}: ${elapsedMs} ms`);
    }

function waitForInvestmentShareImages(root) {
        const images = Array.from(root.querySelectorAll('img'));
        const pendingImages = images.filter((image) => !image.complete);
        if (!pendingImages.length) return Promise.resolve();
        const imageSettled = Promise.allSettled(pendingImages.map((image) => new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
        })));
        const timeout = new Promise((resolve) => window.setTimeout(resolve, 1500));
        return Promise.race([imageSettled, timeout]);
    }

function withInvestmentShareTimeout(promise, timeoutMs, timeoutMessage) {
        let timeoutId = 0;
        const timeout = new Promise((_, reject) => {
            timeoutId = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
        });
        return Promise.race([promise, timeout]).finally(() => {
            if (timeoutId) window.clearTimeout(timeoutId);
        });
    }

async function saveCurrentInvestmentPanelScreenshot() {
        runtime.showInvestmentWorkspaceModal({
            title: runtime.INVESTMENT_SHARE_RENDER_MODAL_TITLE,
            copy: runtime.INVESTMENT_SHARE_RENDER_MODAL_COPY,
            iconClass: runtime.INVESTMENT_SHARE_RENDER_MODAL_ICON_CLASS,
            lockClose: true,
        });
        try {
            const captureStartedAt = performance.now();
            await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
            debugInvestmentShareCaptureTiming('after initial frames', captureStartedAt);
            const captureTarget = await buildInvestmentCommunityShareCard();
            debugInvestmentShareCaptureTiming('after card build', captureStartedAt);
            if (!(captureTarget instanceof HTMLElement)) return;
            const domtoimage = await ensureInvestmentScreenshotLibrary();
            debugInvestmentShareCaptureTiming('after screenshot library ready', captureStartedAt);
            document.body.appendChild(captureTarget);
            try {
                await new Promise((resolve) => window.requestAnimationFrame(resolve));
                stabilizeInvestmentShareDonutOrbits(captureTarget);
                await waitForInvestmentShareImages(captureTarget);
                debugInvestmentShareCaptureTiming('after image readiness', captureStartedAt);
                await new Promise((resolve) => window.requestAnimationFrame(resolve));
                stabilizeInvestmentShareDonutOrbits(captureTarget);
                const captureRect = captureTarget.getBoundingClientRect();
                const blob = await withInvestmentShareTimeout(domtoimage.toBlob(captureTarget, {
                    cacheBust: true,
                    bgcolor: 'transparent',
                    quality: 1,
                    width: Math.max(1, Math.round(captureRect.width)),
                    height: Math.max(1, Math.round(captureRect.height)),
                    style: {
                        transform: 'none',
                    },
                }), 15000, 'Investment screenshot encoding timed out.');
                if (!(blob instanceof Blob)) {
                    throw new Error('Failed to encode screenshot.');
                }
                debugInvestmentShareCaptureTiming('after blob encode', captureStartedAt);
                runtime.downloadBlobFile(buildInvestmentScreenshotFilename(), blob);
            } finally {
                captureTarget.remove();
            }
        } finally {
            runtime.hideInvestmentLoadingModal({ resetContent: true });
        }
    }

function bindInvestmentExportButton() {
        if (!runtime.exportTransactionsButton || runtime.exportTransactionsButton.dataset.bound === '1') return;
        runtime.exportTransactionsButton.dataset.bound = '1';
        runtime.exportTransactionsButton.addEventListener('click', () => {
            const exportPayload = runtime.buildInvestmentMarkdownExport();
            if (!exportPayload) return;
            runtime.downloadMarkdownFile(exportPayload.filename, exportPayload.markdown);
        });
        if (runtime.exportStandardXlsxButton && runtime.exportStandardXlsxButton.dataset.bound !== '1') {
            runtime.exportStandardXlsxButton.dataset.bound = '1';
            runtime.exportStandardXlsxButton.addEventListener('click', async () => {
                if (runtime.exportStandardXlsxButton.getAttribute('aria-busy') === 'true') return;
                runtime.exportStandardXlsxButton.setAttribute('aria-busy', 'true');
                try {
                    await runtime.exportStandardInvestmentXlsx();
                } catch (error) {
                    runtime.setImportFeedback(
                        error instanceof Error
                            ? error.message
                            : 'The standard investment workbook could not be exported.',
                        'error',
                    );
                } finally {
                    runtime.exportStandardXlsxButton.removeAttribute('aria-busy');
                }
            });
        }
        if (runtime.shareMaskButton && runtime.shareMaskButton.dataset.bound !== '1') {
            runtime.shareMaskButton.dataset.bound = '1';
            runtime.syncInvestmentShareMaskButtonState();
            runtime.shareMaskButton.addEventListener('click', () => {
                runtime.state.investmentShareMaskEnabled = !runtime.state.investmentShareMaskEnabled;
                runtime.syncInvestmentShareMaskState();
            });
        }
        if (runtime.shareCaptureButton && runtime.shareCaptureButton.dataset.bound !== '1') {
            runtime.shareCaptureButton.dataset.bound = '1';
            runtime.shareCaptureButton.addEventListener('click', async () => {
                if (runtime.shareCaptureButton.getAttribute('aria-busy') === 'true') return;
                runtime.shareCaptureButton.setAttribute('aria-busy', 'true');
                try {
                    await saveCurrentInvestmentPanelScreenshot();
                } catch (error) {
                    console.error('Failed to save investment screenshot.', error);
                } finally {
                    runtime.shareCaptureButton.removeAttribute('aria-busy');
                }
            });
        }
        runtime.syncInvestmentShareMaskState();
    }

function bindHoldingsLogoFallbacks(container) {
        if (!container) return;
        container.querySelectorAll('[data-investment-logo-image]').forEach((logo) => {
            if (logo.dataset.logoFallbackBound === '1') return;
            logo.dataset.logoFallbackBound = '1';
            const row = logo.closest('.ticker-identity-row');
            const placeholder = row?.querySelector('.ticker-identity-logo-placeholder');
            const logoUrls = (() => {
                try {
                    return JSON.parse(logo.dataset.logoUrl || '[]');
                } catch {
                    return logo.dataset.logoUrl || '';
                }
            })();
            const ticker = logo.dataset.ticker || '';
            runtime.syncInvestmentTickerLogoAsset(
                logo instanceof HTMLImageElement ? logo : null,
                placeholder instanceof HTMLElement ? placeholder : null,
                logoUrls,
                ticker ? `${ticker} logo` : '',
            );
        });
    }

function getInvestmentScrollIntentBucket(bucketName) {
        return runtime.investmentScrollIntentState[bucketName] || null;
    }

function bindInvestmentScrollIntent(container, bucketName) {
        if (!(container instanceof HTMLElement) || !bucketName || container.dataset.investmentScrollIntentBound === '1') {
            return container;
        }
        container.dataset.investmentScrollIntentBound = '1';
        container.addEventListener('scroll', () => {
            const bucket = getInvestmentScrollIntentBucket(bucketName);
            if (!bucket) return;
            if (Date.now() < bucket.ignoreUntil) return;
            bucket.suppressUntil = Date.now() + runtime.INVESTMENT_MANUAL_SCROLL_SUPPRESS_MS;
        }, { passive: true });
        return container;
    }

function getInvestmentHistoryScrollContainer() {
        return bindInvestmentScrollIntent(
            runtime.investmentHistorySurface?.querySelector('#history_table_wrap .investment-history-table-scroll'),
            'history',
        );
    }

function getInvestmentHistoryTableBody() {
        return runtime.investmentHistorySurface?.querySelector('#history_table_wrap .investment-history-table-scroll #investment_history');
    }

function getInvestmentHistoryRowsByLedgerNos(ledgerNos) {
        const scrollContainer = getInvestmentHistoryScrollContainer();
        return Array.from(new Set((Array.isArray(ledgerNos) ? ledgerNos : [])
            .map((ledgerNo) => Number(ledgerNo))
            .filter((ledgerNo) => Number.isFinite(ledgerNo) && ledgerNo > 0)))
            .map((ledgerNo) => {
                const selector = `tr[data-investment-history-row="${CSS.escape(String(ledgerNo))}"]`;
                return scrollContainer?.querySelector(selector) || document.querySelector(selector);
            })
            .filter(Boolean);
    }

function getInvestmentHistoryRowById(rowId) {
        const normalizedRowId = String(rowId || '').trim();
        if (!normalizedRowId) return null;
        return getInvestmentHistoryScrollContainer()?.querySelector(`#${CSS.escape(normalizedRowId)}`)
            || document.getElementById(normalizedRowId);
    }

function getInvestmentStockDetailsScrollContainer() {
        return bindInvestmentScrollIntent(document.querySelector('.investment-stock-details-table-scroll'), 'stockDetails');
    }

function getInvestmentStockDetailRowsByLedgerNos(ledgerNos) {
        return Array.from(new Set((Array.isArray(ledgerNos) ? ledgerNos : [])
            .map((ledgerNo) => Number(ledgerNo))
            .filter((ledgerNo) => Number.isFinite(ledgerNo) && ledgerNo > 0)))
            .map((ledgerNo) => document.querySelector(`tr[data-investment-stock-detail-ledger="${CSS.escape(String(ledgerNo))}"]`))
            .filter(Boolean);
    }

function getInvestmentStockDetailsPageForLedgerNos(ledgerNos) {
        const activeTicker = runtime.normalizeInvestmentTicker(runtime.state.selectedInvestmentStockTicker || '');
        if (!activeTicker) return 0;
        const visibleRows = runtime.getVisibleInvestmentStockDetailTransactions(
            runtime.buildSafeInvestmentStockDetailRows(runtime.state.investmentProcessedTransactionsCache, activeTicker),
        );
        const normalizedLedgerNos = new Set(normalizeInvestmentLedgerNos(ledgerNos));
        const targetIndex = visibleRows.findIndex((row) => normalizedLedgerNos.has(Number(row?.ledger_no)));
        if (targetIndex < 0) return 0;
        return Math.floor(targetIndex / runtime.INVESTMENT_HISTORY_PAGE_SIZE) + 1;
    }

function clearInvestmentHistoryHighlights() {
        runtime.state.activeInvestmentHistoryRowIds.forEach((rowId) => {
            const row = getInvestmentHistoryRowById(rowId);
            if (!row) return;
            row.classList.remove('is-metric-hover-active');
            row.classList.remove('is-metric-hover-target');
        });
        runtime.state.activeInvestmentHistoryRowIds = [];
    }

function clearInvestmentStockDetailHighlights() {
        runtime.state.activeInvestmentStockDetailRowIds.forEach((rowId) => {
            const row = document.getElementById(rowId);
            if (!row) return;
            row.classList.remove('is-metric-hover-active');
            row.classList.remove('is-metric-hover-target');
        });
        runtime.state.activeInvestmentStockDetailRowIds = [];
    }

function getElementScrollOffsetWithinContainer(element, scrollContainer) {
        if (!(element instanceof HTMLElement) || !(scrollContainer instanceof HTMLElement)) return 0;
        const elementRect = element.getBoundingClientRect();
        const containerRect = scrollContainer.getBoundingClientRect();
        return scrollContainer.scrollTop + (elementRect.top - containerRect.top);
    }

function markInvestmentProgrammaticScroll(bucketName, behavior = 'auto') {
        const bucket = getInvestmentScrollIntentBucket(bucketName);
        if (!bucket) return;
        const guardMs = behavior === 'smooth'
            ? runtime.INVESTMENT_PROGRAMMATIC_SCROLL_GUARD_MS
            : Math.min(220, runtime.INVESTMENT_PROGRAMMATIC_SCROLL_GUARD_MS);
        bucket.ignoreUntil = Date.now() + guardMs;
    }

function shouldSuppressInvestmentAutoScroll(bucketName) {
        const bucket = getInvestmentScrollIntentBucket(bucketName);
        return Boolean(bucket && Date.now() < bucket.suppressUntil);
    }

function scrollInvestmentHistoryRowsIntoView(rows, behavior = 'smooth') {
        const normalizedRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
        if (!normalizedRows.length) return;
        const sortedRows = [...normalizedRows].sort((leftRow, rightRow) => leftRow.offsetTop - rightRow.offsetTop);
        const firstRow = sortedRows[0];
        const scrollContainer = getInvestmentHistoryScrollContainer();
        if (scrollContainer) {
            if (shouldSuppressInvestmentAutoScroll('history')) return;
            const edgePadding = Math.max(12, Math.min(24, Math.round(scrollContainer.clientHeight * 0.08)));
            const firstRowTop = getElementScrollOffsetWithinContainer(firstRow, scrollContainer);
            const lastRowBottom = Math.max(...sortedRows.map((row) => getElementScrollOffsetWithinContainer(row, scrollContainer) + row.offsetHeight));
            const visibleTop = scrollContainer.scrollTop + edgePadding;
            const visibleBottom = scrollContainer.scrollTop + scrollContainer.clientHeight - edgePadding;
            const isGroupAlreadyVisible = firstRowTop >= visibleTop && lastRowBottom <= visibleBottom;
            if (isGroupAlreadyVisible) return;
            const targetTop = firstRowTop - edgePadding;
            markInvestmentProgrammaticScroll('history', behavior);
            scrollContainer.scrollTo({ top: Math.max(0, targetTop), behavior });
            return;
        }
        firstRow.scrollIntoView({ block: 'nearest', behavior });
    }

function scrollInvestmentStockDetailRowIntoView(row, behavior = 'smooth') {
        if (!row) return;
        const scrollContainer = getInvestmentStockDetailsScrollContainer();
        if (scrollContainer) {
            if (shouldSuppressInvestmentAutoScroll('stockDetails')) return;
            const rowOffset = row.offsetTop - scrollContainer.offsetTop;
            const targetTop = rowOffset - (scrollContainer.clientHeight / 2) + (row.clientHeight / 2);
            markInvestmentProgrammaticScroll('stockDetails', behavior);
            scrollContainer.scrollTo({ top: Math.max(0, targetTop), behavior });
            return;
        }
        row.scrollIntoView({ block: 'center', behavior });
    }

function activateInvestmentHistoryRows(ledgerNos, { behavior = 'smooth', scroll = true } = {}) {
        const rows = getInvestmentHistoryRowsByLedgerNos(ledgerNos);
        if (!rows.length && scroll) {
            const targetPage = runtime.getInvestmentHistoryPageForLedgerNos(ledgerNos);
            if (targetPage > 0 && targetPage !== runtime.state.investmentHistoryCurrentPage) {
                runtime.state.investmentHistoryCurrentPage = targetPage;
                runtime.renderInvestmentHistoryTableRows(runtime.state.investmentProcessedTransactionsCache, runtime.state.investmentChartPointsCache);
            }
        }
        const resolvedRows = getInvestmentHistoryRowsByLedgerNos(ledgerNos);
        if (!resolvedRows.length) return;
        const resolvedRowIds = resolvedRows
            .map((row) => String(row.id || '').trim())
            .filter(Boolean);
        const isAlreadyActive = resolvedRowIds.length === runtime.state.activeInvestmentHistoryRowIds.length
            && resolvedRowIds.every((rowId, index) => rowId === runtime.state.activeInvestmentHistoryRowIds[index])
            && resolvedRows.every((row) => row.classList.contains('is-metric-hover-active'));
        if (isAlreadyActive) {
            if (scroll) scrollInvestmentHistoryRowsIntoView(resolvedRows, behavior);
            return;
        }
        clearInvestmentHistoryHighlights();
        resolvedRows.forEach((row) => {
            row.classList.add('is-metric-hover-target');
            row.classList.add('is-metric-hover-active');
        });
        runtime.state.activeInvestmentHistoryRowIds = resolvedRowIds;
        if (scroll) {
            scrollInvestmentHistoryRowsIntoView(resolvedRows, behavior);
        }
    }

function activateInvestmentStockDetailRows(ledgerNos, { behavior = 'smooth', scroll = true } = {}) {
        let rows = getInvestmentStockDetailRowsByLedgerNos(ledgerNos);
        if (!rows.length && runtime.state.activeInvestmentView === 'stock_details' && scroll) {
            const targetPage = getInvestmentStockDetailsPageForLedgerNos(ledgerNos);
            if (targetPage > 0 && targetPage !== runtime.state.investmentHistoryCurrentPage) {
                runtime.state.investmentHistoryCurrentPage = targetPage;
                runtime.refreshInvestmentStockDetailsTableRows({refreshHeaders: false});
                rows = getInvestmentStockDetailRowsByLedgerNos(ledgerNos);
            }
        }
        if (!rows.length) {
            clearInvestmentStockDetailHighlights();
            return;
        }
        rows.forEach((row, index) => {
            if (!row.id) {
                row.id = `investment_stock_detail_row_${ledgerNos[index]}`;
            }
        });
        const resolvedRowIds = rows.map((row) => row.id).filter(Boolean);
        const isAlreadyActive = resolvedRowIds.length === runtime.state.activeInvestmentStockDetailRowIds.length
            && resolvedRowIds.every((rowId, index) => rowId === runtime.state.activeInvestmentStockDetailRowIds[index])
            && rows.every((row) => row.classList.contains('is-metric-hover-active'));
        if (isAlreadyActive) {
            if (scroll) scrollInvestmentStockDetailRowIntoView(rows[0], behavior);
            return;
        }
        clearInvestmentStockDetailHighlights();
        rows.forEach((row) => {
            row.classList.add('is-metric-hover-target');
            row.classList.add('is-metric-hover-active');
        });
        runtime.state.activeInvestmentStockDetailRowIds = resolvedRowIds;
        if (scroll) {
            scrollInvestmentStockDetailRowIntoView(rows[0], behavior);
        }
    }

function syncInvestmentStockDetailPreviewRows(ledgerNos, { behavior = 'auto', scroll = false } = {}) {
        const normalizedLedgerNos = Array.from(new Set((Array.isArray(ledgerNos) ? ledgerNos : [])
            .map((ledgerNo) => Number(ledgerNo))
            .filter((ledgerNo) => Number.isFinite(ledgerNo) && ledgerNo > 0)));
        if (!normalizedLedgerNos.length) {
            clearInvestmentStockDetailHighlights();
            return;
        }
        const matchingRows = getInvestmentStockDetailRowsByLedgerNos(normalizedLedgerNos);
        if (!matchingRows.length) {
            clearInvestmentStockDetailHighlights();
            return;
        }
        activateInvestmentStockDetailRows(normalizedLedgerNos, { behavior, scroll });
    }

function getLatestHistoryRowForTicker(ticker) {
        const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
        if (!normalizedTicker) return null;
        return document.querySelector(`tr[data-investment-history-ticker="${CSS.escape(normalizedTicker)}"]`);
    }

function getHistoryRowsForLedgerDate(rawDate) {
        const normalizedDate = String(rawDate || '').match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || '';
        if (!normalizedDate) return [];
        return Array.from(document.querySelectorAll(`tr[data-investment-history-date="${CSS.escape(normalizedDate)}"]`));
    }

function normalizeInvestmentLedgerNos(ledgerNos) {
        return Array.from(new Set((Array.isArray(ledgerNos) ? ledgerNos : [])
            .map((ledgerNo) => Number(ledgerNo))
            .filter((ledgerNo) => Number.isFinite(ledgerNo) && ledgerNo > 0)))
            .sort((left, right) => left - right);
    }

function getStockDetailLedgerNoForHistoryLedgerNo(ledgerNo, historyTicker = '') {
        const normalizedLedgerNo = Number(ledgerNo);
        const activeTicker = runtime.getInvestmentCanonicalTicker(runtime.state.selectedInvestmentStockTicker || '');
        const normalizedHistoryTicker = runtime.getInvestmentCanonicalTicker(historyTicker);
        if (
            !Number.isFinite(normalizedLedgerNo)
            || normalizedLedgerNo <= 0
            || !activeTicker
            || normalizedHistoryTicker !== activeTicker
        ) return 0;
        return getInvestmentStockDetailRowsByLedgerNos([normalizedLedgerNo]).length
            ? normalizedLedgerNo
            : 0;
    }

function syncInvestmentHoverLinkedViews({
        hoverTicker = '',
        hoverLedgerNo = 0,
        historyLedgerNos = [],
        stockDetailLedgerNos = [],
        interactionLedgerNo = 0,
        historyBehavior = 'auto',
        historyScroll = false,
        stockDetailBehavior = 'auto',
        stockDetailScroll = false,
    } = {}) {
        const normalizedHistoryLedgerNos = normalizeInvestmentLedgerNos(historyLedgerNos);
        const normalizedStockDetailLedgerNos = normalizeInvestmentLedgerNos(stockDetailLedgerNos);
        const normalizedInteractionLedgerNo = Number(interactionLedgerNo);
        const normalizedHoverLedgerNo = Number(hoverLedgerNo);
        const focusLedgerNo = (Number.isFinite(normalizedHoverLedgerNo) && normalizedHoverLedgerNo > 0 ? normalizedHoverLedgerNo : 0)
            || normalizedStockDetailLedgerNos[0]
            || normalizedHistoryLedgerNos[0]
            || (Number.isFinite(normalizedInteractionLedgerNo) && normalizedInteractionLedgerNo > 0 ? normalizedInteractionLedgerNo : 0);
        runtime.syncHoldingsChartHoverState(hoverTicker, focusLedgerNo);
        if (normalizedHistoryLedgerNos.length) {
            activateInvestmentHistoryRows(normalizedHistoryLedgerNos, {
                behavior: historyBehavior,
                scroll: historyScroll,
            });
        } else {
            clearInvestmentHistoryHighlights();
        }
        if (normalizedStockDetailLedgerNos.length) {
            syncInvestmentStockDetailPreviewRows(normalizedStockDetailLedgerNos, {
                behavior: stockDetailBehavior,
                scroll: stockDetailScroll,
            });
        } else {
            clearInvestmentStockDetailHighlights();
        }
    }

    return {
        getInvestmentShareViewTitle,
        getInvestmentShareViewLabel,
        getInvestmentShareViewSubtitle,
        getInvestmentProjectMeta,
        getInvestmentShareTimestampText,
        sanitizeInvestmentShareClone,
        createInvestmentShareHeader,
        ensureInvestmentQrCodeFactory,
        createInvestmentShareQrNode,
        createInvestmentShareFooter,
        createInvestmentShareTemplateFrame,
        createInvestmentShareSection,
        readInvestmentShareSafePaddingPx,
        resolveInvestmentShareChartInstance,
        createInvestmentShareChartDataUrl,
        createInvestmentShareChartImage,
        createInvestmentShareChartSection,
        buildInvestmentOverviewShareBody,
        stabilizeInvestmentShareDonutOrbits,
        buildInvestmentStockDetailsShareBody,
        buildInvestmentHoldingsShareTable,
        buildInvestmentHoldingsShareBody,
        buildInvestmentMetricsShareBody,
        buildInvestmentCommunityShareCard,
        buildInvestmentScreenshotFilename,
        ensureInvestmentScreenshotLibrary,
        debugInvestmentShareCaptureTiming,
        waitForInvestmentShareImages,
        withInvestmentShareTimeout,
        saveCurrentInvestmentPanelScreenshot,
        bindInvestmentExportButton,
        bindHoldingsLogoFallbacks,
        getInvestmentScrollIntentBucket,
        bindInvestmentScrollIntent,
        getInvestmentHistoryScrollContainer,
        getInvestmentHistoryTableBody,
        getInvestmentHistoryRowsByLedgerNos,
        getInvestmentHistoryRowById,
        getInvestmentStockDetailsScrollContainer,
        getInvestmentStockDetailRowsByLedgerNos,
        getInvestmentStockDetailsPageForLedgerNos,
        clearInvestmentHistoryHighlights,
        clearInvestmentStockDetailHighlights,
        getElementScrollOffsetWithinContainer,
        markInvestmentProgrammaticScroll,
        shouldSuppressInvestmentAutoScroll,
        scrollInvestmentHistoryRowsIntoView,
        scrollInvestmentStockDetailRowIntoView,
        activateInvestmentHistoryRows,
        activateInvestmentStockDetailRows,
        syncInvestmentStockDetailPreviewRows,
        getLatestHistoryRowForTicker,
        getHistoryRowsForLedgerDate,
        normalizeInvestmentLedgerNos,
        getStockDetailLedgerNoForHistoryLedgerNo,
        syncInvestmentHoverLinkedViews,
    };
}

