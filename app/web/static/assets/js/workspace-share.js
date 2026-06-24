/* Code version: v0.1.0 */
(() => {
	const bootstrap = window.ANTIGRAVITY_BOOTSTRAP = window.ANTIGRAVITY_BOOTSTRAP || {};
	const appState = () => window.ANTIGRAVITY_APP || {};
	const workspaceModalOverlay = document.getElementById("workspace_modal_overlay");
	const workspaceModalOverlayTitle = workspaceModalOverlay?.querySelector(".workspace-modal-title");
	const workspaceModalOverlayCopy = workspaceModalOverlay?.querySelector(".workspace-modal-copy");
	const workspaceModalOverlayIcon = document.getElementById("workspace_modal_overlay_icon");
	const workspaceModalOverlayClose = document.getElementById("workspace_modal_overlay_close");
	const WORKSPACE_MODAL_DEFAULT_TITLE = String(workspaceModalOverlayTitle?.textContent || "").trim();
	const WORKSPACE_MODAL_DEFAULT_COPY = String(workspaceModalOverlayCopy?.textContent || "").trim();
	const WORKSPACE_MODAL_DEFAULT_ICON_CLASS = String(workspaceModalOverlayIcon?.className || "").trim();
	const SHARE_RENDER_MODAL_TITLE = "Rendering share image";
	const SHARE_RENDER_MODAL_COPY = "We are rendering the community share card and encoding the PNG export. Please wait until the image finishes saving.";
	const SHARE_RENDER_MODAL_ICON_CLASS = "icon-hourglass";

	const providers = new Map();
	let qrCodeLibraryPromise = null;
	let screenshotLibraryPromise = null;
	let sharePositionFrame = 0;
	let shareListenersBound = false;

	const getActiveViewId = () => String(appState().currentView || "").trim();

	const getDrawerForView = (viewId = getActiveViewId()) => {
		if (!viewId) return null;
		const drawer = document.querySelector(`[data-share-drawer="${viewId}"]`);
		return drawer instanceof HTMLElement ? drawer : null;
	};

	const getProviderForView = (viewId = getActiveViewId()) => providers.get(viewId) || null;

	const showWorkspaceShareModal = ({
		title = SHARE_RENDER_MODAL_TITLE,
		copy = SHARE_RENDER_MODAL_COPY,
		iconClass = SHARE_RENDER_MODAL_ICON_CLASS,
		lockClose = false,
	} = {}) => {
		if (!workspaceModalOverlay) return;
		if (workspaceModalOverlayTitle) workspaceModalOverlayTitle.textContent = title;
		if (workspaceModalOverlayCopy) workspaceModalOverlayCopy.textContent = copy;
		if (workspaceModalOverlayIcon) {
			workspaceModalOverlayIcon.className = `icon ${iconClass} workspace-modal-icon`;
		}
		if (workspaceModalOverlayClose) {
			workspaceModalOverlayClose.hidden = lockClose;
			workspaceModalOverlayClose.disabled = lockClose;
			workspaceModalOverlayClose.setAttribute("aria-hidden", lockClose ? "true" : "false");
		}
		workspaceModalOverlay.hidden = false;
	};

	const hideWorkspaceShareModal = ({ resetContent = false } = {}) => {
		if (!workspaceModalOverlay) return;
		workspaceModalOverlay.hidden = true;
		if (workspaceModalOverlayClose) {
			workspaceModalOverlayClose.hidden = false;
			workspaceModalOverlayClose.disabled = false;
			workspaceModalOverlayClose.setAttribute("aria-hidden", "false");
		}
		if (!resetContent) return;
		if (workspaceModalOverlayTitle && WORKSPACE_MODAL_DEFAULT_TITLE) {
			workspaceModalOverlayTitle.textContent = WORKSPACE_MODAL_DEFAULT_TITLE;
		}
		if (workspaceModalOverlayCopy && WORKSPACE_MODAL_DEFAULT_COPY) {
			workspaceModalOverlayCopy.textContent = WORKSPACE_MODAL_DEFAULT_COPY;
		}
		if (workspaceModalOverlayIcon && WORKSPACE_MODAL_DEFAULT_ICON_CLASS) {
			workspaceModalOverlayIcon.className = WORKSPACE_MODAL_DEFAULT_ICON_CLASS;
		}
	};

	const getProjectMeta = () => {
		const sourceUrl = String(appState().project?.sourceUrl || "").trim();
		const displayUrl = String(appState().project?.displayUrl || "").trim();
		return {
			sourceUrl: sourceUrl || window.location.href,
			displayUrl: displayUrl || sourceUrl.replace(/^https?:\/\//, "") || window.location.host,
		};
	};

	const getShareTimestampText = () => {
		const formatter = new Intl.DateTimeFormat("en-GB", {
			timeZone: "Asia/Hong_Kong",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hourCycle: "h23",
		});
		const parts = Object.create(null);
		formatter.formatToParts(new Date()).forEach((part) => {
			if (part.type !== "literal") parts[part.type] = part.value;
		});
		return `${parts.day}/${parts.month}/${parts.year}\n${parts.hour}:${parts.minute}:${parts.second} HKT`;
	};

	const sanitizeWorkspaceShareClone = (node, { removeWinnerBadge = false } = {}) => {
		if (!(node instanceof HTMLElement)) return node;
		node.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
		node.querySelectorAll("[data-bound], [data-chart-mounted], [data-trade-chart-ready]").forEach((element) => {
			element.removeAttribute("data-bound");
			element.removeAttribute("data-chart-mounted");
			element.removeAttribute("data-trade-chart-ready");
		});
		if (removeWinnerBadge) {
			node.querySelectorAll(".winner-badge").forEach((element) => element.remove());
		}
		return node;
	};

	const createWorkspaceShareSection = (className = "") => {
		const section = document.createElement("div");
		section.className = ["investment-community-share-section", className].filter(Boolean).join(" ");
		return section;
	};

	const createWorkspaceShareTemplateFrame = ({ shareView, title }) => {
		const host = document.createElement("div");
		host.className = "investment-community-share-capture";
		host.style.setProperty("--investment-community-share-shell-export-width", "540px");
		host.style.setProperty("--investment-community-share-shell-export-height", "856px");
		host.style.setProperty("--investment-community-share-footer-brand-size", "72px");
		host.style.setProperty("--investment-community-share-footer-qr-size", "108px");

		const card = document.createElement("article");
		card.className = "investment-community-share-card";
		card.dataset.shareView = shareView;
		card.dataset.shareTemplate = "stable-v1";

		const header = document.createElement("div");
		header.className = "investment-community-share-header";
		const heading = document.createElement("div");
		heading.className = "investment-community-share-heading";
		const titleNode = document.createElement("p");
		titleNode.className = "investment-community-share-title";
		titleNode.textContent = String(title || "").trim();
		heading.appendChild(titleNode);
		header.appendChild(heading);

		const body = document.createElement("div");
		body.className = "investment-community-share-body";
		card.appendChild(header);
		card.appendChild(body);
		host.appendChild(card);
		return { host, card, body };
	};

	const ensureWorkspaceShareQrCodeFactory = async () => {
		if (typeof window.qrcode === "function") return window.qrcode;
		if (qrCodeLibraryPromise) return qrCodeLibraryPromise;
		qrCodeLibraryPromise = new Promise((resolve, reject) => {
			const existingScript = document.querySelector('script[data-workspace-share-library="qrcode-generator"]');
			if (existingScript) {
				existingScript.addEventListener("load", () => resolve(window.qrcode), { once: true });
				existingScript.addEventListener("error", () => reject(new Error("Failed to load QR code renderer.")), { once: true });
				return;
			}
			const script = document.createElement("script");
			script.src = "/static/assets/js/vendor/qrcode-generator.js";
			script.async = true;
			script.dataset.workspaceShareLibrary = "qrcode-generator";
			script.addEventListener("load", () => {
				if (typeof window.qrcode === "function") {
					resolve(window.qrcode);
					return;
				}
				reject(new Error("QR code renderer loaded without exposing factory."));
			}, { once: true });
			script.addEventListener("error", () => reject(new Error("Failed to load QR code renderer.")), { once: true });
			document.head.appendChild(script);
		}).catch((error) => {
			qrCodeLibraryPromise = null;
			throw error;
		});
		return qrCodeLibraryPromise;
	};

	const createWorkspaceShareQrNode = async (sourceUrl) => {
		const qrFactory = await ensureWorkspaceShareQrCodeFactory();
		const qr = qrFactory(0, "M");
		qr.addData(String(sourceUrl || "").trim());
		qr.make();
		const moduleCount = qr.getModuleCount();
		const margin = 2;
		const viewBoxSize = moduleCount + margin * 2;
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("viewBox", `0 0 ${viewBoxSize} ${viewBoxSize}`);
		svg.setAttribute("aria-hidden", "true");
		svg.setAttribute("focusable", "false");
		const pathData = [];
		for (let row = 0; row < moduleCount; row += 1) {
			for (let col = 0; col < moduleCount; col += 1) {
				if (!qr.isDark(row, col)) continue;
				const x = col + margin;
				const y = row + margin;
				pathData.push(`M${x} ${y}h1v1H${x}z`);
			}
		}
		const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute("d", pathData.join(""));
		path.setAttribute("fill", "currentColor");
		svg.appendChild(path);
		return svg;
	};

	const createWorkspaceShareFooter = async () => {
		const projectMeta = getProjectMeta();
		const footer = document.createElement("div");
		footer.className = "investment-community-share-footer";
		footer.dataset.shareTemplateFixed = "1";

		const brandIcon = document.createElement("img");
		brandIcon.className = "investment-community-share-footer-brand-icon";
		brandIcon.src = "/market-store/logos/favicon.svg";
		brandIcon.alt = "";
		brandIcon.decoding = "sync";
		footer.appendChild(brandIcon);

		const copy = document.createElement("div");
		copy.className = "investment-community-share-footer-copy";
		const timestamp = document.createElement("div");
		timestamp.className = "investment-community-share-footer-timestamp";
		timestamp.textContent = getShareTimestampText();
		copy.appendChild(timestamp);
		footer.appendChild(copy);

		const qrShell = document.createElement("div");
		qrShell.className = "investment-community-share-footer-qr";
		qrShell.appendChild(await createWorkspaceShareQrNode(projectMeta.sourceUrl));
		footer.appendChild(qrShell);
		return footer;
	};

	const readWorkspaceShareChartDataUrl = (canvas) => {
		if (!(canvas instanceof HTMLCanvasElement)) return null;
		const chartInstance = window.Chart?.getChart?.(canvas);
		try {
			return chartInstance?.toBase64Image?.("image/png", 1) || canvas.toDataURL("image/png");
		} catch (_error) {
			return chartInstance?.toBase64Image?.("image/png", 1) || null;
		}
	};

	const createWorkspaceShareChartSection = (canvas, className = "investment-community-share-section--chart") => {
		const chartDataUrl = readWorkspaceShareChartDataUrl(canvas);
		if (!chartDataUrl) return null;
		const image = document.createElement("img");
		image.className = "investment-community-share-chart-image";
		image.alt = "";
		image.decoding = "sync";
		image.src = chartDataUrl;
		const section = createWorkspaceShareSection(className);
		const shell = document.createElement("div");
		shell.className = "investment-community-share-chart-shell";
		shell.appendChild(image);
		section.appendChild(shell);
		return section;
	};

	const inlineWorkspaceShareImage = async (image) => {
		if (!(image instanceof HTMLImageElement)) return;
		const source = image.currentSrc || image.src;
		if (!source || source.startsWith("data:") || source.startsWith("blob:")) return;
		try {
			const response = await fetch(source, { credentials: "same-origin" });
			if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
			const blob = await response.blob();
			const dataUrl = await new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(reader.result);
				reader.onerror = () => reject(reader.error || new Error("Failed to read image blob."));
				reader.readAsDataURL(blob);
			});
			if (typeof dataUrl === "string") image.src = dataUrl;
		} catch (_error) {
			image.remove();
		}
	};

	const inlineWorkspaceShareImages = async (root) => {
		if (!(root instanceof HTMLElement)) return;
		await Promise.all(Array.from(root.querySelectorAll("img")).map((image) => inlineWorkspaceShareImage(image)));
	};

	const ensureWorkspaceScreenshotLibrary = async () => {
		if (window.domtoimage?.toBlob) return window.domtoimage;
		if (screenshotLibraryPromise) return screenshotLibraryPromise;
		const loadScript = (src) => new Promise((resolve, reject) => {
			const script = document.createElement("script");
			script.src = src;
			script.async = true;
			script.dataset.workspaceShareLibrary = "dom-to-image-more";
			script.addEventListener("load", () => {
				if (window.domtoimage?.toBlob) {
					resolve(window.domtoimage);
					return;
				}
				reject(new Error("Screenshot library loaded without exposing dom-to-image-more."));
			}, { once: true });
			script.addEventListener("error", () => reject(new Error("Failed to load screenshot library.")), { once: true });
			document.head.appendChild(script);
		});
		screenshotLibraryPromise = loadScript("/static/assets/js/vendor/dom-to-image-more.min.js").catch(() => loadScript(
			"https://cdn.jsdelivr.net/npm/dom-to-image-more@3.6.0/dist/dom-to-image-more.min.js",
		)).catch((error) => {
			screenshotLibraryPromise = null;
			throw error;
		});
		return screenshotLibraryPromise;
	};

	const downloadWorkspaceShareBlob = (filename, blob) => {
		const objectUrl = window.URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = objectUrl;
		link.download = filename;
		document.body.appendChild(link);
		link.click();
		link.remove();
		window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 0);
	};

	const waitForWorkspaceShareImages = (root) => {
		const images = Array.from(root.querySelectorAll("img"));
		const pendingImages = images.filter((image) => !image.complete);
		if (!pendingImages.length) return Promise.resolve();
		const imageSettled = Promise.allSettled(pendingImages.map((image) => new Promise((resolve) => {
			image.addEventListener("load", resolve, { once: true });
			image.addEventListener("error", resolve, { once: true });
		})));
		return Promise.race([imageSettled, new Promise((resolve) => window.setTimeout(resolve, 1500))]);
	};

	const withWorkspaceShareTimeout = (promise, timeoutMs, timeoutMessage) => {
		let timeoutId = 0;
		const timeout = new Promise((_, reject) => {
			timeoutId = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
		});
		return Promise.race([promise, timeout]).finally(() => {
			if (timeoutId) window.clearTimeout(timeoutId);
		});
	};

	const buildWorkspaceShareFilename = (prefix, slug = "share") => {
		const timestamp = new Date().toISOString().replace(/[:]/g, "-").replace(/\.\d{3}Z$/, "Z");
		const normalizedSlug = String(slug || "share").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "share";
		return `${prefix}-${normalizedSlug}-${timestamp}.png`;
	};

	const saveWorkspaceShareScreenshot = async (provider) => {
		if (!provider || typeof provider.buildCard !== "function" || typeof provider.buildFilename !== "function") {
			throw new Error("Workspace share provider is not configured.");
		}
		const modalLabels = provider.modalLabels || {};
		showWorkspaceShareModal({
			title: modalLabels.renderingTitle || SHARE_RENDER_MODAL_TITLE,
			copy: modalLabels.renderingCopy || SHARE_RENDER_MODAL_COPY,
			lockClose: true,
		});
		let failed = false;
		try {
			await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
			const captureTarget = await provider.buildCard();
			const domtoimage = await ensureWorkspaceScreenshotLibrary();
			document.body.appendChild(captureTarget);
			try {
				await inlineWorkspaceShareImages(captureTarget);
				await waitForWorkspaceShareImages(captureTarget);
				await new Promise((resolve) => window.requestAnimationFrame(resolve));
				const captureRect = captureTarget.getBoundingClientRect();
				const blob = await withWorkspaceShareTimeout(domtoimage.toBlob(captureTarget, {
					cacheBust: true,
					bgcolor: "transparent",
					quality: 1,
					width: Math.max(1, Math.round(captureRect.width)),
					height: Math.max(1, Math.round(captureRect.height)),
					style: {
						transform: "none",
					},
				}), 30000, "Screenshot encoding timed out.");
				if (!(blob instanceof Blob)) throw new Error("Failed to encode screenshot.");
				downloadWorkspaceShareBlob(provider.buildFilename(), blob);
			} finally {
				captureTarget.remove();
			}
		} catch (error) {
			failed = true;
			console.error("Failed to save workspace share screenshot.", error);
			hideWorkspaceShareModal({ resetContent: true });
			showWorkspaceShareModal({
				title: modalLabels.failedTitle || "Screenshot export failed",
				copy: error instanceof Error ? error.message : "Screenshot export failed.",
				iconClass: "icon-modal-dialog-banner-default",
				lockClose: false,
			});
			window.setTimeout(() => hideWorkspaceShareModal({ resetContent: true }), 3200);
			throw error;
		} finally {
			if (!failed) hideWorkspaceShareModal({ resetContent: true });
		}
	};

	const syncWorkspaceShareDrawerPosition = () => {
		const drawer = getDrawerForView();
		const headingRow = document.querySelector(".workspace-mode-results-stack .workspace-summary-card .report-heading-row");
		if (!(drawer instanceof HTMLElement) || !(headingRow instanceof HTMLElement)) return;
		const rect = headingRow.getBoundingClientRect();
		if (!rect.height) return;
		const centerY = rect.top + (rect.height / 2);
		drawer.style.setProperty("--investment-share-actions-top", `${centerY}px`);
		drawer.style.top = `${centerY}px`;
	};

	const scheduleWorkspaceShareDrawerPosition = () => {
		if (sharePositionFrame) window.cancelAnimationFrame(sharePositionFrame);
		sharePositionFrame = window.requestAnimationFrame(() => {
			sharePositionFrame = 0;
			syncWorkspaceShareDrawerPosition();
		});
	};

	const syncWorkspaceShareDrawerVisibility = () => {
		const drawer = getDrawerForView();
		const provider = getProviderForView();
		if (!(drawer instanceof HTMLElement)) return;
		const isReady = typeof provider?.isReady === "function" ? Boolean(provider.isReady()) : false;
		drawer.hidden = !isReady;
		if (!drawer.hidden) scheduleWorkspaceShareDrawerPosition();
	};

	const bindWorkspaceShareCaptureButton = (button, provider) => {
		if (!(button instanceof HTMLElement) || button.dataset.bound === "1") return;
		button.dataset.bound = "1";
		button.addEventListener("click", async (event) => {
			event.preventDefault();
			event.stopPropagation();
			if (button.getAttribute("aria-busy") === "true") return;
			button.setAttribute("aria-busy", "true");
			try {
				await saveWorkspaceShareScreenshot(provider);
			} catch (_error) {
			} finally {
				button.removeAttribute("aria-busy");
			}
		});
	};

	const bindWorkspaceShareAnchorButton = (button, provider) => {
		if (!(button instanceof HTMLElement) || button.dataset.bound === "1") return;
		button.dataset.bound = "1";
		if (typeof provider?.onAnchorClick !== "function") return;
		button.addEventListener("click", (event) => {
			provider.onAnchorClick(event);
		});
	};

	bootstrap.registerWorkspaceShareProvider = (viewId, provider) => {
		const normalizedViewId = String(viewId || "").trim();
		if (!normalizedViewId || !provider || typeof provider !== "object") return;
		providers.set(normalizedViewId, provider);
		syncWorkspaceShareDrawerVisibility();
	};

	bootstrap.initWorkspaceShareDrawer = () => {
		const viewId = getActiveViewId();
		const drawer = getDrawerForView(viewId);
		const provider = getProviderForView(viewId);
		if (!(drawer instanceof HTMLElement) || !provider) return;

		bindWorkspaceShareCaptureButton(drawer.querySelector("#share_capture_button"), provider);
		bindWorkspaceShareAnchorButton(drawer.querySelector("#export_transactions_button"), provider);

		if (!shareListenersBound) {
			shareListenersBound = true;
			window.addEventListener("resize", scheduleWorkspaceShareDrawerPosition);
			window.addEventListener("scroll", scheduleWorkspaceShareDrawerPosition, true);
			window.addEventListener("antigravity:workspace-share-ready", syncWorkspaceShareDrawerVisibility);
		}

		ensureWorkspaceScreenshotLibrary().catch(() => {});
		syncWorkspaceShareDrawerVisibility();
		scheduleWorkspaceShareDrawerPosition();
	};

	bootstrap.syncWorkspaceShareDrawerPosition = scheduleWorkspaceShareDrawerPosition;
	bootstrap.syncWorkspaceShareDrawerVisibility = syncWorkspaceShareDrawerVisibility;
	const areTradeWorkspaceChartsReady = () => {
		const priceCanvas = document.getElementById("tradePriceChart");
		const equityCanvas = document.getElementById("tradeEquityChart");
		return Boolean(
			priceCanvas?.dataset.tradeChartReady === "1"
			&& equityCanvas?.dataset.tradeChartReady === "1",
		);
	};

	const buildTradeWorkspaceShareCard = async ({ shareView, title }) => {
		const metricsPanel = document.getElementById("backtest_metrics_panel");
		const priceCanvas = document.getElementById("tradePriceChart");
		const equityCanvas = document.getElementById("tradeEquityChart");
		if (!(metricsPanel instanceof HTMLElement) || !areTradeWorkspaceChartsReady()) {
			throw new Error("Trade workspace charts are not ready for screenshot export.");
		}
		const metricsSection = createWorkspaceShareSection("investment-community-share-section--chart investment-community-share-section--padded");
		const metricsClone = sanitizeWorkspaceShareClone(metricsPanel.cloneNode(true));
		if (metricsClone instanceof HTMLElement) {
			metricsClone.classList.add("workspace-share-metrics-card", "investment-community-share-metrics-grid");
			metricsSection.appendChild(metricsClone);
		}
		const priceSection = createWorkspaceShareChartSection(
			priceCanvas,
			"investment-community-share-section--chart workspace-share-section--trade-chart",
		);
		const equitySection = createWorkspaceShareChartSection(
			equityCanvas,
			"investment-community-share-section--chart workspace-share-section--trade-chart",
		);
		if (!(priceSection instanceof HTMLElement) || !(equitySection instanceof HTMLElement)) {
			throw new Error("Trade workspace chart capture failed.");
		}
		const frame = createWorkspaceShareTemplateFrame({ shareView, title });
		frame.body.appendChild(metricsSection);
		frame.body.appendChild(priceSection);
		frame.body.appendChild(equitySection);
		frame.card.appendChild(await createWorkspaceShareFooter());
		return frame.host;
	};

	const dispatchWorkspaceShareReady = (viewId = getActiveViewId()) => {
		const normalizedViewId = String(viewId || "").trim();
		if (!normalizedViewId) return;
		window.dispatchEvent(new CustomEvent("antigravity:workspace-share-ready", {
			detail: { view: normalizedViewId },
		}));
	};

	bootstrap.workspaceShare = {
		createSection: createWorkspaceShareSection,
		createTemplateFrame: createWorkspaceShareTemplateFrame,
		createFooter: createWorkspaceShareFooter,
		createChartSection: createWorkspaceShareChartSection,
		sanitizeClone: sanitizeWorkspaceShareClone,
		buildFilename: buildWorkspaceShareFilename,
		buildTradeCard: buildTradeWorkspaceShareCard,
		areTradeChartsReady: areTradeWorkspaceChartsReady,
		dispatchReady: dispatchWorkspaceShareReady,
	};
})();