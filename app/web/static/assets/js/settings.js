/* Code version: v0.3.1 */
(() => {
    const bootstrap = window.ANTIGRAVITY_BOOTSTRAP = window.ANTIGRAVITY_BOOTSTRAP || {};
    let settingsContext = null;
    let localStorePaginationRequest = null;
    let didBindSettingsSectionNavigation = false;
    let didBindLocalStorePagination = false;
    let didBindStyleTokenControlDismiss = false;
    let styleTokenActiveControl = null;
    let activeStyleTokenResizerCleanup = null;
    let activeStyleTokenDemoDensityCleanup = null;
    let refreshStyleTokenDemoDensity = null;

    const getContext = () => settingsContext || {};
    const getState = () => getContext().state || null;
    const getEndpoints = () => getContext().endpoints || {};
    const getLabels = () => getContext().labels || {};
    const canTransitionDom = () => Boolean(getContext().canTransitionDom);
    const rememberCurrentViewUrl = (url) => getContext().rememberCurrentViewUrl?.(url);
    const getProgressiveManifest = (view, section = null) => getContext().getProgressiveManifest?.(view, section) || {masks: []};
    const fetchJsonCached = (...args) => getContext().fetchJsonCached?.(...args);
    const reinitializeSettingsWorkspaceRegion = () => {
        bootstrap.initSettingsWorkspace?.(getContext());
    };

    const writeTextToClipboard = async (value) => {
        if (!value) return false;
        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(value);
                return true;
            } catch (_error) {
            }
        }

        const legacyCopyViaExecCommand = () => {
            const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            const selection = window.getSelection ? window.getSelection() : null;
            const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
            const textarea = document.createElement("textarea");
            textarea.value = value;
            textarea.setAttribute("readonly", "");
            textarea.style.position = "fixed";
            textarea.style.top = "0";
            textarea.style.left = "0";
            textarea.style.width = "1px";
            textarea.style.height = "1px";
            textarea.style.padding = "0";
            textarea.style.border = "0";
            textarea.style.outline = "0";
            textarea.style.boxShadow = "none";
            textarea.style.background = "transparent";
            textarea.style.opacity = "0";
            textarea.style.pointerEvents = "none";
            document.body.append(textarea);
            textarea.focus();
            textarea.select();
            textarea.setSelectionRange(0, textarea.value.length);
            let didCopy = false;
            try {
                didCopy = document.execCommand("copy");
            } catch (_error) {
                didCopy = false;
            }
            textarea.remove();
            if (selection) {
                selection.removeAllRanges();
                if (previousRange) selection.addRange(previousRange);
            }
            activeElement?.focus?.({preventScroll: true});
            return didCopy;
        };

        const legacyCopyViaEvent = () => {
            let didCopy = false;
            const onCopy = (event) => {
                event.preventDefault();
                event.clipboardData?.setData("text/plain", value);
                didCopy = true;
            };
            document.addEventListener("copy", onCopy, {capture: true, once: true});
            try {
                document.execCommand("copy");
            } catch (_error) {
                didCopy = false;
            }
            return didCopy;
        };

        return legacyCopyViaEvent() || legacyCopyViaExecCommand();
    };

    const attachBrokerSettingsHandlers = () => {
        const brokerSelect = document.getElementById("selected_broker");
        if (!(brokerSelect instanceof HTMLSelectElement) || brokerSelect.dataset.bound === "1") return;
        brokerSelect.dataset.bound = "1";
        brokerSelect.addEventListener("change", () => {
            const selected = brokerSelect.value;
            document.querySelectorAll("[data-broker-fields]").forEach((element) => {
                if (!(element instanceof HTMLElement)) return;
                element.hidden = element.dataset.brokerFields !== selected;
            });
        });
    };

    const attachStyleTokenResizer = () => {
        const shell = document.querySelector("[data-style-token-shell]");
        const handle = shell?.querySelector("[data-style-token-resizer]");
        if (typeof activeStyleTokenResizerCleanup === "function") {
            activeStyleTokenResizerCleanup();
            activeStyleTokenResizerCleanup = null;
        }
        if (!(shell instanceof HTMLElement) || !(handle instanceof HTMLElement) || handle.dataset.bound === "1") return;
        handle.dataset.bound = "1";
        const scrollViewport = shell.closest("[data-settings-workspace-region]");
        const minWidth = 220;
        const clampWidth = (desiredWidth) => {
            const rect = shell.getBoundingClientRect();
            if (!rect.width) return null;
            const computed = getComputedStyle(shell);
            const columnGap = Number.parseFloat(computed.getPropertyValue("--style-token-column-gap")) || 24;
            const maxWidth = Math.max(minWidth, rect.width - columnGap - 280);
            return Math.min(Math.max(desiredWidth, minWidth), maxWidth);
        };
        const syncWidth = (clientX) => {
            const rect = shell.getBoundingClientRect();
            if (!rect.width) return;
            const computed = getComputedStyle(shell);
            const columnGap = Number.parseFloat(computed.getPropertyValue("--style-token-column-gap")) || 24;
            const nextWidth = clampWidth(clientX - rect.left - (columnGap / 2));
            if (!Number.isFinite(nextWidth)) return;
            shell.style.setProperty("--style-token-demo-width-current", `${nextWidth}px`);
            refreshStyleTokenDemoDensity?.();
        };
        const syncWidthToViewport = () => {
            refreshStyleTokenDemoDensity?.();
            syncHandleY();
        };
        let geometryFrame = 0;
        const scheduleGeometrySync = () => {
            if (geometryFrame) return;
            geometryFrame = window.requestAnimationFrame(() => {
                geometryFrame = 0;
                syncWidthToViewport();
            });
        };
        const stopResize = () => {
            shell.classList.remove("is-resizing");
            if (typeof handle.releasePointerCapture === "function" && activePointerId !== null) {
                try {
                    handle.releasePointerCapture(activePointerId);
                } catch (_error) {
                }
            }
            activePointerId = null;
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", stopResize);
            window.removeEventListener("pointercancel", stopResize);
        };
        const onPointerMove = (event) => {
            syncWidth(event.clientX);
        };
        let activePointerId = null;
        handle.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            activePointerId = typeof event.pointerId === "number" ? event.pointerId : null;
            if (typeof handle.setPointerCapture === "function" && activePointerId !== null) {
                try {
                    handle.setPointerCapture(activePointerId);
                } catch (_error) {
                }
            }
            shell.classList.add("is-resizing");
            syncWidth(event.clientX);
            window.addEventListener("pointermove", onPointerMove);
            window.addEventListener("pointerup", stopResize);
            window.addEventListener("pointercancel", stopResize);
        });
        const syncHandleY = () => {
            const rect = shell.getBoundingClientRect();
            if (!rect.height) return;
            const viewportRect = scrollViewport instanceof HTMLElement
                ? scrollViewport.getBoundingClientRect()
                : {top: 0, bottom: window.innerHeight};
            const visibleTop = Math.max(viewportRect.top, rect.top);
            const visibleBottom = Math.min(viewportRect.bottom, rect.bottom);
            const visibleHeight = visibleBottom - visibleTop;
            if (visibleHeight <= 0) return;

            const visibleCenterY = visibleTop + (visibleHeight / 2);
            let targetY = visibleCenterY - rect.top;
            targetY = Math.min(Math.max(16, targetY), rect.height - 16);
            shell.style.setProperty("--style-token-resizer-y", `${targetY}px`);
        };

        window.addEventListener("scroll", scheduleGeometrySync, {passive: true});
        scrollViewport?.addEventListener?.("scroll", scheduleGeometrySync, {passive: true});
        window.addEventListener("resize", scheduleGeometrySync, {passive: true});

        let resizeObserver = null;
        if (window.ResizeObserver) {
            resizeObserver = new ResizeObserver(() => {
                scheduleGeometrySync();
            });
            resizeObserver.observe(shell);
        }

        scheduleGeometrySync();
        setTimeout(scheduleGeometrySync, 150);
        activeStyleTokenResizerCleanup = () => {
            stopResize();
            window.removeEventListener("scroll", scheduleGeometrySync);
            scrollViewport?.removeEventListener?.("scroll", scheduleGeometrySync);
            window.removeEventListener("resize", scheduleGeometrySync);
            resizeObserver?.disconnect();
            if (geometryFrame) {
                window.cancelAnimationFrame(geometryFrame);
                geometryFrame = 0;
            }
            delete handle.dataset.bound;
        };
    };

    const attachStyleTokenDemoResponsiveness = () => {
        const shell = document.querySelector("[data-style-token-shell]");
        if (typeof activeStyleTokenDemoDensityCleanup === "function") {
            activeStyleTokenDemoDensityCleanup();
            activeStyleTokenDemoDensityCleanup = null;
        }
        refreshStyleTokenDemoDensity = null;
        if (!(shell instanceof HTMLElement)) return;
        const demos = Array.from(shell.querySelectorAll(".style-token-demo")).filter((element) => element instanceof HTMLElement);
        if (!demos.length) return;

        const applyDensity = () => {
            const computed = getComputedStyle(shell);
            const width = Number.parseFloat(computed.getPropertyValue("--style-token-demo-width-effective"))
                || Number.parseFloat(computed.getPropertyValue("--style-token-demo-width-current"))
                || Number.parseFloat(computed.getPropertyValue("--style-token-demo-width"))
                || 0;
            const density = width <= 320 ? "tight" : width <= 360 ? "compact" : "regular";
            shell.dataset.styleTokenDensity = density;
            demos.forEach((demo) => {
                demo.dataset.styleTokenDensity = density;
            });
        };
        refreshStyleTokenDemoDensity = applyDensity;

        let resizeObserver = null;
        if (window.ResizeObserver) {
            resizeObserver = new ResizeObserver(() => {
                applyDensity();
            });
            applyDensity();
            resizeObserver.observe(shell);
        } else {
            const syncAllDensities = () => {
                applyDensity();
            };
            syncAllDensities();
            window.addEventListener("resize", syncAllDensities, {passive: true});
            activeStyleTokenDemoDensityCleanup = () => {
                window.removeEventListener("resize", syncAllDensities);
                refreshStyleTokenDemoDensity = null;
            };
            return;
        }

        activeStyleTokenDemoDensityCleanup = () => {
            resizeObserver?.disconnect();
            refreshStyleTokenDemoDensity = null;
        };
    };

    const attachStyleTokenControls = () => {
        const shell = document.querySelector("[data-style-token-shell]");
        if (!(shell instanceof HTMLElement)) return;
        const setActiveControl = (nextControl) => {
            if (styleTokenActiveControl instanceof HTMLElement && styleTokenActiveControl !== nextControl) {
                styleTokenActiveControl.classList.remove("is-editing");
            }
            styleTokenActiveControl = nextControl instanceof HTMLElement ? nextControl : null;
            if (styleTokenActiveControl instanceof HTMLElement) {
                styleTokenActiveControl.classList.add("is-editing");
            }
        };
        const controlsByToken = new Map();
        shell.querySelectorAll("[data-style-token-control]").forEach((control) => {
            if (!(control instanceof HTMLElement)) return;
            const tokenName = control.dataset.styleTokenName || "";
            if (!tokenName) return;
            if (!controlsByToken.has(tokenName)) controlsByToken.set(tokenName, []);
            controlsByToken.get(tokenName).push(control);
        });
        shell.querySelectorAll("[data-style-token-control]").forEach((control) => {
            if (!(control instanceof HTMLElement) || control.dataset.bound === "1") return;
            control.dataset.bound = "1";
            const tokenName = control.dataset.styleTokenName || "";
            const unit = control.dataset.styleTokenUnit || "";
            const minValue = Number.parseInt(control.dataset.styleTokenMin || "0", 10);
            const valueInput = control.querySelector(".style-token-value-input");
            const applyValue = (nextValue) => {
                if (!tokenName || !Number.isFinite(nextValue)) return;
                const safeValue = Math.max(Number.isFinite(minValue) ? minValue : 0, nextValue);
                shell.style.setProperty(tokenName, `${safeValue}${unit}`);
                (controlsByToken.get(tokenName) || []).forEach((peerControl) => {
                    peerControl.dataset.styleTokenValue = String(safeValue);
                    const peerValueText = peerControl.querySelector("[data-style-token-value-text]");
                    if (peerValueText instanceof HTMLInputElement) {
                        peerValueText.value = `${safeValue}${unit}`;
                    } else if (peerValueText instanceof HTMLElement) {
                        peerValueText.textContent = `${safeValue}${unit}`;
                    }
                });
            };
            if (valueInput instanceof HTMLElement) {
                valueInput.addEventListener("click", () => {
                    setActiveControl(control);
                });
                valueInput.addEventListener("focus", () => {
                    setActiveControl(control);
                });
            }
            control.querySelectorAll("[data-style-token-stepper]").forEach((button) => {
                button.addEventListener("click", () => {
                    setActiveControl(control);
                    const direction = button.getAttribute("data-style-token-stepper") === "down" ? -1 : 1;
                    const currentValue = Number.parseInt(control.dataset.styleTokenValue || "0", 10);
                    applyValue(currentValue + direction);
                });
            });
        });
        if (didBindStyleTokenControlDismiss) return;
        didBindStyleTokenControlDismiss = true;
        document.addEventListener("pointerdown", (event) => {
            if (!(event.target instanceof Node)) return;
            if (styleTokenActiveControl instanceof HTMLElement && !styleTokenActiveControl.contains(event.target)) {
                styleTokenActiveControl.classList.remove("is-editing");
                styleTokenActiveControl = null;
            }
        });
    };

    const attachStyleTokenReferences = () => {
        const shell = document.querySelector("[data-style-token-shell]");
        if (!(shell instanceof HTMLElement)) return;
        const pulseTargetCard = (targetId, options = {}) => {
            if (!targetId) return;
            const targetCard = shell.querySelector(`[data-style-token-card="${targetId}"]`);
            if (!(targetCard instanceof HTMLElement)) return;
            if (options.scrollIntoView) {
                targetCard.scrollIntoView({
                    behavior: options.behavior || "smooth",
                    block: options.block || "center",
                });
            }
            targetCard.classList.remove("is-linked-highlight");
            void targetCard.offsetWidth;
            targetCard.classList.add("is-linked-highlight");
            window.setTimeout(() => {
                targetCard.classList.remove("is-linked-highlight");
            }, 700);
        };
        shell.querySelectorAll("[data-style-token-reference]").forEach((reference) => {
            if (!(reference instanceof HTMLElement) || reference.dataset.bound === "1") return;
            reference.dataset.bound = "1";
            const targetId = reference.dataset.styleTokenReference || "";
            reference.addEventListener("pointerenter", () => {
                pulseTargetCard(targetId);
            });
            reference.addEventListener("focus", () => {
                pulseTargetCard(targetId);
            });
            reference.addEventListener("click", (event) => {
                event.preventDefault();
                pulseTargetCard(targetId);
            });
        });
    };

    const revealStyleTokenHashTarget = (hash = window.location.hash) => {
        const shell = document.querySelector("[data-style-token-shell]");
        if (!(shell instanceof HTMLElement) || !hash || !hash.startsWith("#")) return;
        const targetId = decodeURIComponent(hash.slice(1));
        if (!targetId) return;
        const targetCard = shell.querySelector(`[data-style-token-card="${CSS.escape(targetId)}"]`);
        if (!(targetCard instanceof HTMLElement)) return;
        window.requestAnimationFrame(() => {
            targetCard.scrollIntoView({behavior: "smooth", block: "center"});
            targetCard.classList.remove("is-linked-highlight");
            void targetCard.offsetWidth;
            targetCard.classList.add("is-linked-highlight");
            window.setTimeout(() => {
                targetCard.classList.remove("is-linked-highlight");
            }, 700);
        });
    };

    const attachStyleTokenCopyButtons = () => {
        document.querySelectorAll("[data-style-token-copy]").forEach((button) => {
            if (!(button instanceof HTMLButtonElement) || button.dataset.bound === "1") return;
            button.dataset.bound = "1";
            const defaultLabel = button.getAttribute("aria-label") || "Copy style name";
            const showCopiedState = () => {
                button.classList.add("is-copied");
                button.setAttribute("aria-label", "Copied");
                button.setAttribute("title", "Copied");
                window.clearTimeout(Number(button.dataset.copyResetTimer || "0"));
                const timer = window.setTimeout(() => {
                    button.classList.remove("is-copied");
                    button.setAttribute("aria-label", defaultLabel);
                    button.setAttribute("title", "Copy style name");
                    delete button.dataset.copyResetTimer;
                }, 1200);
                button.dataset.copyResetTimer = String(timer);
            };
            button.addEventListener("click", async (event) => {
                event.preventDefault();
                event.stopPropagation();
                const value = button.dataset.styleTokenCopy || "";
                try {
                    const copied = await writeTextToClipboard(value);
                    if (copied) showCopiedState();
                } catch (_error) {
                }
            });
        });
    };

    const attachStyleTokenModeSwitches = () => {
        const shell = document.querySelector("[data-style-token-shell]");
        if (!(shell instanceof HTMLElement)) return;
        shell.querySelectorAll(".style-token-demo .range-mode-shell").forEach((switchShell) => {
            if (!(switchShell instanceof HTMLElement) || switchShell.dataset.bound === "1") return;
            switchShell.dataset.bound = "1";
            const syncActiveValue = () => {
                const checkedInput = switchShell.querySelector('input[type="radio"]:checked');
                const nextValue = checkedInput instanceof HTMLInputElement ? checkedInput.value : "period";
                switchShell.setAttribute("data-active", nextValue === "exact" ? "exact" : "period");
            };
            switchShell.querySelectorAll('input[type="radio"]').forEach((input) => {
                input.addEventListener("change", syncActiveValue);
            });
            syncActiveValue();
        });
    };

    const attachStyleTokenDemoInteractions = () => {
        const shell = document.querySelector("[data-style-token-shell]");
        if (!(shell instanceof HTMLElement) || shell.dataset.bound === "1") return;
        shell.dataset.bound = "1";
        shell.addEventListener("click", (event) => {
            if (!(event.target instanceof Node)) return;
            const dismissButton = event.target.closest(".dismiss-button");
            if (dismissButton) {
                const container = dismissButton.closest(".style-token-modal-demo");
                if (container instanceof HTMLElement) {
                    container.style.display = "none";
                    setTimeout(() => {
                        container.style.display = "";
                    }, 800);
                }
                return;
            }
            const actionButton = event.target.closest(".settings-action-package-form button");
            if (actionButton) {
                const controlContainer = document.querySelector('[data-style-token-name="--settings-action-button-background"]');
                if (controlContainer instanceof HTMLElement) {
                    controlContainer.scrollIntoView({behavior: "smooth", block: "center"});
                    const input = controlContainer.querySelector("input");
                    if (input instanceof HTMLElement) {
                        setTimeout(() => input.focus(), 400);
                    }
                }
                return;
            }
            const pageButton = event.target.closest(".local-store-page-button");
            if (pageButton && !pageButton.classList.contains("local-store-page-nav") && !pageButton.classList.contains("local-store-page-placeholder")) {
                const container = pageButton.closest(".local-store-pagination");
                if (container instanceof HTMLElement) {
                    const buttons = Array.from(container.querySelectorAll(".local-store-page-button:not(.local-store-page-nav):not(.local-store-page-placeholder)"));
                    const index = buttons.indexOf(pageButton);
                    if (index !== -1) {
                        buttons.forEach((button) => button.classList.remove("is-active"));
                        pageButton.classList.add("is-active");
                        const indicator = container.querySelector(".local-store-pagination-indicator");
                        if (indicator instanceof HTMLElement) {
                            indicator.style.transform = `translate3d(calc(var(--local-store-pagination-slot-size) * ${index + 1}), 0, 0)`;
                        }
                    }
                }
            }
        });
    };

    const syncLocalStorePagination = (currentRegion, nextRegion) => {
        if (!(currentRegion instanceof HTMLElement) || !(nextRegion instanceof HTMLElement)) return;
        const currentPagination = currentRegion.querySelector("[data-local-store-pagination]");
        const nextPagination = nextRegion.querySelector("[data-local-store-pagination]");
        if (!(currentPagination instanceof HTMLElement) && !(nextPagination instanceof HTMLElement)) return;
        if (!(currentPagination instanceof HTMLElement) && nextPagination instanceof HTMLElement) {
            currentRegion.append(nextPagination.cloneNode(true));
            return;
        }
        if (currentPagination instanceof HTMLElement && !(nextPagination instanceof HTMLElement)) {
            currentPagination.remove();
            return;
        }
        if (!(currentPagination instanceof HTMLElement) || !(nextPagination instanceof HTMLElement)) return;
        currentPagination.setAttribute("aria-label", nextPagination.getAttribute("aria-label") || "Local market store pages");
        const indicator = currentPagination.querySelector(".local-store-pagination-indicator");
        Array.from(currentPagination.childNodes).forEach((node) => {
            if (node !== indicator) node.remove();
        });
        Array.from(nextPagination.childNodes).forEach((node) => {
            currentPagination.append(node.cloneNode(true));
        });
    };

    const syncLocalStoreRegion = (currentRegion, nextRegion) => {
        if (!(currentRegion instanceof HTMLElement) || !(nextRegion instanceof HTMLElement)) return;
        const currentSummary = currentRegion.querySelector(".settings-summary");
        const nextSummary = nextRegion.querySelector(".settings-summary");
        if (currentSummary instanceof HTMLElement && nextSummary instanceof HTMLElement) {
            currentSummary.replaceWith(nextSummary.cloneNode(true));
        }
        const currentTableWrap = currentRegion.querySelector(".local-store-table-wrap");
        const nextTableWrap = nextRegion.querySelector(".local-store-table-wrap");
        if (currentTableWrap instanceof HTMLElement && nextTableWrap instanceof HTMLElement) {
            currentTableWrap.replaceWith(nextTableWrap.cloneNode(true));
        }
        syncLocalStorePagination(currentRegion, nextRegion);
    };

    const replaceLocalStoreRegion = (nextRegion) => {
        const currentRegion = document.getElementById("local_store_region");
        if (!(currentRegion instanceof HTMLElement) || !nextRegion) return;
        syncLocalStoreRegion(currentRegion, nextRegion);
    };

    const replaceSettingsWorkspaceRegion = async (nextRegion) => {
        const currentRegion = document.getElementById("settings_workspace_region");
        if (!(currentRegion instanceof HTMLElement) || !nextRegion) return;
        const applyReplacement = () => {
            currentRegion.replaceWith(nextRegion);
        };
        if (canTransitionDom()) {
            const transition = document.startViewTransition(applyReplacement);
            try {
                await transition.finished;
            } catch (_error) {
            }
            return;
        }
        applyReplacement();
        await Promise.resolve();
    };

    const buildLocalStorePendingRegion = (pageNumber) => {
        const labels = getLabels();
        const page = Math.max(Number.parseInt(String(pageNumber || new URLSearchParams(window.location.search).get("page") || "1"), 10) || 1, 1);
        const pageSize = 10;
        const startIndex = (page - 1) * pageSize;
        const article = document.createElement("article");
        article.className = "chart-surface settings-surface";
        article.id = "settings_workspace_region";
        article.dataset.settingsWorkspaceRegion = "";
        article.dataset.settingsSection = "local-market-store";
        article.innerHTML = `
			<div class="chart-heading-row">
				<p class="chart-heading">${labels.local_market_store || "Local Market Store"}</p>
			</div>
			<div class="settings-body">
				<div class="local-store-layout" id="local_store_region" data-local-store-region>
					<section class="settings-callout-card settings-callout-card-primary local-store-maintain-card">
						<div class="settings-callout-copy">
							<span class="settings-nav-icon-shell settings-callout-icon-shell" aria-hidden="true"><span class="icon icon-store-maintain"></span></span>
							<div class="settings-callout-text">
								<p class="settings-service-name">${labels.local_store_maintain_title || "Maintain all data"}</p>
								<p class="settings-service-note">${labels.local_store_maintain_note || ""}</p>
							</div>
						</div>
						<span class="settings-inline-button settings-inline-button-primary is-pending" aria-hidden="true">${labels.local_store_maintain_button || "Maintain all data"}</span>
					</section>
					<p class="settings-summary">${labels.local_store_summary || ""}</p>
					<div class="scrollable-data-table-shell local-store-table-shell">
						<table class="settings-table local-store-table scrollable-data-table" aria-hidden="true">
							<colgroup>
								<col class="local-store-col-index">
								<col class="local-store-col-symbol">
								<col class="local-store-col-name">
								<col class="local-store-col-range">
								<col class="local-store-col-update">
								<col class="local-store-col-1m">
								<col class="local-store-col-delete">
							</colgroup>
							<thead>
								<tr>
									<th class="local-store-col-index">No.</th>
									<th>${labels.local_store_symbol || "Ticker"}</th>
									<th>${labels.local_store_name || "Name"}</th>
									<th>${labels.local_store_range || "Range"}</th>
									<th>1d</th>
									<th>${labels.local_store_intraday || "1m"}</th>
									<th>${labels.local_store_delete || ""}</th>
								</tr>
							</thead>
						</table>
						<div class="settings-table-wrap local-store-table-wrap scrollable-data-table-scroll">
							<table class="settings-table local-store-table scrollable-data-table">
								<colgroup>
									<col class="local-store-col-index">
									<col class="local-store-col-symbol">
									<col class="local-store-col-name">
									<col class="local-store-col-range">
									<col class="local-store-col-update">
									<col class="local-store-col-1m">
									<col class="local-store-col-delete">
								</colgroup>
								<tbody>
								${Array.from({length: 6}, (_, index) => `
									<tr data-local-store-ticker="pending-${index + 1}">
										<td class="local-store-index-cell is-pending-value" data-workspace-mask="metric-value">${startIndex + index + 1}</td>
										<td>
											<span class="settings-symbol-cell">
												<span class="settings-table-logo settings-table-logo-placeholder" aria-hidden="true"></span>
												<span class="is-pending-value" data-workspace-mask="company-name">TICK</span>
											</span>
										</td>
										<td data-local-store-company class="is-pending-value" data-workspace-mask="company-name">Loading</td>
										<td class="local-store-range-cell">
											<span class="local-store-range-value">
												<span class="local-store-range-token is-pending-value" data-workspace-mask="local-store-date" data-local-store-range="start">0000/00/00</span>
												<span class="local-store-range-separator"> - </span>
												<span class="local-store-range-token is-pending-value" data-workspace-mask="local-store-date" data-local-store-range="end">0000/00/00</span>
											</span>
										</td>
										<td><span class="settings-action-button is-pending" aria-hidden="true"><span class="icon icon-store-refresh"></span></span></td>
										<td><span class="settings-action-button is-pending" aria-hidden="true"><span class="icon icon-store-fetch-1m"></span></span></td>
										<td><span class="settings-action-button is-danger is-pending" aria-hidden="true"><span class="icon icon-store-delete"></span></span></td>
									</tr>
								`).join("")}
								</tbody>
							</table>
						</div>
					</div>
				</div>
			</div>
		`;
        return article;
    };

    const setActiveSettingsNav = (targetSection) => {
        let activeIndex = 0;
        let currentIndex = 0;
        document.querySelectorAll(".settings-nav-item").forEach((link) => {
            if (!(link instanceof HTMLElement)) return;
            const isTarget = link.getAttribute("href")?.includes(`/settings/${targetSection}`);
            link.classList.toggle("is-active", Boolean(isTarget));
            if (isTarget) {
                link.setAttribute("aria-current", "page");
                activeIndex = currentIndex;
            } else {
                link.removeAttribute("aria-current");
            }
            currentIndex++;
        });
        
        const nav = document.querySelector(".settings-nav");
        if (nav instanceof HTMLElement) {
            nav.style.setProperty("--settings-active-index", String(activeIndex));
        }
    };

    const hydrateLocalStoreRanges = async () => {
        const state = getState();
        const endpoints = getEndpoints();
        if (state?.currentView !== "settings" || state.settingsSection !== "local-market-store") return;
        const region = document.getElementById("local_store_region");
        if (!(region instanceof HTMLElement)) return;
        const rows = Array.from(region.querySelectorAll("[data-local-store-ticker]"));
        if (!rows.length) return;
        const hasPendingDateToken = rows.some((row) => row.querySelector('[data-workspace-mask="local-store-date"].is-pending-value'));
        if (!hasPendingDateToken || !endpoints.localStorePageData) return;
        const page = new URLSearchParams(window.location.search).get("page") || "1";
        try {
            const payload = await fetchJsonCached(
                `local-store:${page}`,
                `${endpoints.localStorePageData}?page=${encodeURIComponent(page)}`,
                {ttlMs: 0},
            );
            (payload?.rows || []).forEach((item) => {
                const row = region.querySelector(`[data-local-store-ticker="${CSS.escape(item.ticker || "")}"]`);
                if (!(row instanceof HTMLElement)) return;
                const startNode = row.querySelector('[data-local-store-range="start"]');
                const endNode = row.querySelector('[data-local-store-range="end"]');
                const companyNode = row.querySelector("[data-local-store-company]");
                if (companyNode instanceof HTMLElement && !companyNode.textContent.trim() && item.company_name) {
                    companyNode.textContent = item.company_name;
                }
                if (startNode instanceof HTMLElement) {
                    startNode.textContent = item.range_start || "";
                    startNode.classList.toggle("is-pending-value", !item.range_start);
                }
                if (endNode instanceof HTMLElement) {
                    endNode.textContent = item.range_end || "";
                    endNode.classList.toggle("is-pending-value", !item.range_end);
                }
            });
        } catch (_error) {
        }
    };

    const setNetworkStatusesPending = () => {
        const summaryCheckedAtNode = document.querySelector("[data-network-last-checked]");
        if (summaryCheckedAtNode instanceof HTMLElement) summaryCheckedAtNode.textContent = "Last checked: Checking...";
        document.querySelectorAll("[data-settings-service-row]").forEach((row) => {
            const statusNode = row.querySelector("[data-settings-service-status]");
            const noteNode = row.querySelector("[data-settings-service-note]");
            const checkedAtNode = row.querySelector("[data-settings-service-checked-at]");
            const iconNode = row.querySelector("[data-settings-service-icon]");
            const stateNode = row.querySelector(".settings-service-state");
            if (statusNode instanceof HTMLElement) statusNode.textContent = "Checking...";
            if (iconNode instanceof HTMLElement) {
                iconNode.classList.remove("is-visible");
                iconNode.classList.add("is-pending-status");
            }
            if (stateNode instanceof HTMLElement) stateNode.classList.add("is-muted");
            if (noteNode instanceof HTMLElement) {
                const pendingNote = noteNode.dataset.pendingNote || "";
                if (pendingNote) noteNode.textContent = pendingNote;
            }
            if (checkedAtNode instanceof HTMLElement) checkedAtNode.textContent = "Last checked: Checking...";
        });
    };

    const hydrateNetworkStatuses = async ({force = false} = {}) => {
        const state = getState();
        const endpoints = getEndpoints();
        if (state?.currentView !== "settings" || state.settingsSection !== "network" || !endpoints.settingsNetworkStatus) return;
        try {
            if (force && getContext().progressiveResourceCache) {
                getContext().progressiveResourceCache.delete("settings-network-status");
            }
            const payload = await fetchJsonCached(
                "settings-network-status",
                force ? `${endpoints.settingsNetworkStatus}?refresh=1` : endpoints.settingsNetworkStatus,
                {ttlMs: force ? 0 : 45000},
            );
            const summaryCheckedAtNode = document.querySelector("[data-network-last-checked]");
            const firstCheckedAtText = payload?.rows?.[0]?.checked_at_text || "";
            if (summaryCheckedAtNode instanceof HTMLElement) {
                summaryCheckedAtNode.textContent = firstCheckedAtText || "Last checked: Not checked yet.";
            }
            (payload?.rows || []).forEach((item) => {
                const row = document.querySelector(`[data-settings-service-row][data-service-key="${CSS.escape(item.key || "")}"]`);
                if (!(row instanceof HTMLElement)) return;
                const statusNode = row.querySelector("[data-settings-service-status]");
                const noteNode = row.querySelector("[data-settings-service-note]");
                const checkedAtNode = row.querySelector("[data-settings-service-checked-at]");
                const iconNode = row.querySelector("[data-settings-service-icon]");
                const stateNode = row.querySelector(".settings-service-state");
                if (statusNode instanceof HTMLElement) statusNode.textContent = item.status || "";
                if (noteNode instanceof HTMLElement) noteNode.textContent = item.note || "";
                if (checkedAtNode instanceof HTMLElement) checkedAtNode.textContent = item.checked_at_text || "";
                if (stateNode instanceof HTMLElement) stateNode.classList.toggle("is-muted", !item.is_available);
                if (iconNode instanceof HTMLElement) {
                    iconNode.classList.remove("is-pending-status");
                    iconNode.classList.toggle("is-visible", Boolean(item.is_available));
                }
            });
        } catch (_error) {
        }
    };

    const attachNetworkRefreshButton = () => {
        const button = document.querySelector("[data-network-refresh-button]");
        if (!(button instanceof HTMLButtonElement) || button.dataset.bound === "1") return;
        button.dataset.bound = "1";
        button.addEventListener("click", async () => {
            setNetworkStatusesPending();
            button.disabled = true;
            button.classList.add("is-pending");
            button.setAttribute("aria-busy", "true");
            try {
                await hydrateNetworkStatuses({force: true});
            } finally {
                button.disabled = false;
                button.classList.remove("is-pending");
                button.removeAttribute("aria-busy");
            }
        });
    };

    const ensureLocalStorePaginationIndicator = (pagination) => {
        if (!(pagination instanceof HTMLElement)) return null;
        let indicator = pagination.querySelector(".local-store-pagination-indicator");
        if (!(indicator instanceof HTMLElement)) {
            indicator = document.createElement("span");
            indicator.className = "local-store-pagination-indicator";
            indicator.setAttribute("aria-hidden", "true");
            pagination.prepend(indicator);
        }
        return indicator;
    };

    const positionLocalStorePaginationIndicator = (pagination, target, {immediate = false} = {}) => {
        if (!(pagination instanceof HTMLElement) || !(target instanceof HTMLElement)) return;
        const indicator = ensureLocalStorePaginationIndicator(pagination);
        if (!(indicator instanceof HTMLElement)) return;
        const navRect = pagination.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const x = targetRect.left - navRect.left;
        const y = targetRect.top - navRect.top;
        if (immediate) indicator.style.transition = "none";
        indicator.style.width = `${targetRect.width}px`;
        indicator.style.height = `${targetRect.height}px`;
        indicator.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        pagination.classList.add("is-animated");
        if (immediate) {
            void indicator.offsetWidth;
            indicator.style.removeProperty("transition");
        }
    };

    const initLocalStorePaginationPhysics = () => {
        const pagination = document.querySelector("[data-local-store-pagination]");
        if (!(pagination instanceof HTMLElement)) return;
        const active = pagination.querySelector(".local-store-page-button.is-active");
        if (!(active instanceof HTMLElement)) return;
        pagination.classList.remove("is-animating");
        pagination.classList.add("is-animated");
        positionLocalStorePaginationIndicator(pagination, active, {immediate: true});
        pagination.querySelectorAll(".local-store-page-button[data-pagination-target]").forEach((button) => {
            if (button instanceof HTMLElement) {
                button.dataset.paginationCurrent = button.classList.contains("is-active") ? "1" : "0";
            }
        });
    };

    const syncLocalStorePaginationActivePage = (pageValue) => {
        const pagination = document.querySelector("[data-local-store-pagination]");
        if (!(pagination instanceof HTMLElement)) return;
        const page = String(pageValue || "1");
        const buttons = Array.from(pagination.querySelectorAll(".local-store-page-button"));
        const target = buttons.find((button) => {
            if (!(button instanceof HTMLElement)) return false;
            if (button.classList.contains("local-store-page-nav") || button.classList.contains("local-store-page-placeholder")) return false;
            return button.textContent?.trim() === page;
        });
        if (!(target instanceof HTMLElement)) {
            window.requestAnimationFrame(() => initLocalStorePaginationPhysics());
            return;
        }
        buttons.forEach((button) => {
            if (!(button instanceof HTMLElement)) return;
            const isTarget = button === target;
            button.classList.toggle("is-active", isTarget);
            button.dataset.paginationCurrent = isTarget ? "1" : "0";
        });
        pagination.classList.remove("is-animating");
        pagination.classList.add("is-animated");
        window.requestAnimationFrame(() => {
            positionLocalStorePaginationIndicator(pagination, target, {immediate: true});
        });
    };

    const fetchLocalStorePage = async (url, {pushHistory = true} = {}) => {
        const response = await fetch(url, {
            headers: {
                "X-Requested-With": "fetch",
            },
            credentials: "same-origin",
            cache: "no-store",
        });
        if (!response.ok) throw new Error(`Local store page fetch failed: ${response.status}`);
        const html = await response.text();
        const parser = new DOMParser();
        const nextDocument = parser.parseFromString(html, "text/html");
        const nextRegion = nextDocument.querySelector("#local_store_region");
        if (!nextRegion) throw new Error("Local store region missing from response.");
        replaceLocalStoreRegion(nextRegion);
        if (pushHistory) window.history.pushState({localStore: true}, "", url);
        rememberCurrentViewUrl(url);
        void hydrateLocalStoreRanges();
        const targetPage = new URL(url, window.location.origin).searchParams.get("page") || "1";
        syncLocalStorePaginationActivePage(targetPage);
    };

    const animateLocalStorePaginationTo = (link, targetUrl) => new Promise((resolve) => {
        const pagination = link.closest("[data-local-store-pagination]");
        if (!(pagination instanceof HTMLElement)) {
            resolve();
            return;
        }
        
        const targetPage = new URL(targetUrl, window.location.origin).searchParams.get("page") || "1";
        const buttons = Array.from(pagination.querySelectorAll(".local-store-page-button"));
        const target = buttons.find((button) => {
            if (!(button instanceof HTMLElement)) return false;
            if (button.classList.contains("local-store-page-nav") || button.classList.contains("local-store-page-placeholder")) return false;
            return button.textContent?.trim() === targetPage;
        });

        if (!(target instanceof HTMLElement)) {
            resolve();
            return;
        }

        const current = pagination.querySelector(".local-store-page-button.is-active") || pagination.querySelector(".local-store-page-button[data-pagination-current='1']");
        if (!(current instanceof HTMLElement)) {
            positionLocalStorePaginationIndicator(pagination, target, {immediate: true});
            resolve();
            return;
        }
        pagination.classList.add("is-animated", "is-animating");
        
        // Optimistically update classes so the text color and background toggle immediately
        current.classList.remove("is-active");
        target.classList.add("is-active");
        
        current.dataset.paginationCurrent = "0";
        target.dataset.paginationCurrent = "1";
        positionLocalStorePaginationIndicator(pagination, current, {immediate: true});
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                positionLocalStorePaginationIndicator(pagination, target);
            });
        });
        window.setTimeout(() => {
            pagination.classList.remove("is-animating");
            resolve();
        }, 430);
    });

    const attachLocalStorePagination = () => {
        initLocalStorePaginationPhysics();
        if (didBindLocalStorePagination) return;
        didBindLocalStorePagination = true;
        document.addEventListener("click", (event) => {
            const link = event.target.closest(".local-store-pagination a");
            if (!(link instanceof HTMLAnchorElement)) return;
            if (!window.location.pathname.startsWith("/settings/local-market-store")) return;
            const targetUrl = link.href;
            if (!targetUrl) return;
            event.preventDefault();
            if (localStorePaginationRequest) return;
            localStorePaginationRequest = (async () => {
                try {
                    const targetPage = new URL(targetUrl, window.location.origin).searchParams.get("page") || "1";
                    const pendingRegion = buildLocalStorePendingRegion(targetPage);
                    const currentRegion = document.getElementById("local_store_region");
                    if (currentRegion && pendingRegion) {
                        const currentTableWrap = currentRegion.querySelector(".local-store-table-wrap");
                        const nextTableWrap = pendingRegion.querySelector(".local-store-table-wrap");
                        if (currentTableWrap && nextTableWrap) {
                            currentTableWrap.replaceWith(nextTableWrap);
                        }
                    }
                    const animationPromise = animateLocalStorePaginationTo(link, targetUrl);
                    await Promise.all([animationPromise, fetchLocalStorePage(targetUrl)]);
                } catch (_error) {
                    window.location.assign(targetUrl);
                } finally {
                    localStorePaginationRequest = null;
                }
            })();
        });

        window.addEventListener("popstate", () => {
            if (!window.location.pathname.startsWith("/settings/local-market-store")) return;
            fetchLocalStorePage(window.location.pathname + window.location.search, {pushHistory: false}).catch(() => {
            });
        });
    };

    const attachSettingsSectionNavigation = () => {
        if (didBindSettingsSectionNavigation) return;
        didBindSettingsSectionNavigation = true;

        document.addEventListener("click", async (event) => {
            const state = getState();
            const link = event.target.closest(".settings-nav-item, [data-settings-section-link]");
            if (!(link instanceof HTMLAnchorElement) || state?.currentView !== "settings") return;
            const nextUrl = link.href;
            if (!nextUrl) return;
            const parsed = new URL(nextUrl, window.location.origin);
            const targetSection = link.dataset.settingsSectionLink || parsed.pathname.split("/")[2] || "about";
            if (
                targetSection === state.settingsSection
                && parsed.search === window.location.search
                && parsed.hash === window.location.hash
            ) return;
            event.preventDefault();
            setActiveSettingsNav(targetSection);
            if (targetSection === "local-market-store") {
                const targetPage = parsed.searchParams.get("page") || "1";
                replaceSettingsWorkspaceRegion(buildLocalStorePendingRegion(targetPage));
            }
            try {
                const responseText = await fetch(nextUrl, {
                    credentials: "same-origin",
                    headers: {"X-Requested-With": "settings-prefetch"},
                    cache: targetSection === "local-market-store" ? "no-store" : "force-cache",
                }).then(async (response) => {
                    if (!response.ok) throw new Error(`Settings prefetch failed: ${response.status}`);
                    return response.text();
                });
                const parser = new DOMParser();
                const nextDocument = parser.parseFromString(responseText, "text/html");
                const nextRegion = nextDocument.querySelector("#settings_workspace_region");
                if (!nextRegion) throw new Error("Settings workspace region missing.");
                await replaceSettingsWorkspaceRegion(nextRegion);
                reinitializeSettingsWorkspaceRegion();
                window.history.pushState({settingsSection: targetSection}, "", nextUrl);
                state.settingsSection = targetSection;
                rememberCurrentViewUrl(nextUrl);
                if (parsed.hash) {
                    revealStyleTokenHashTarget(parsed.hash);
                }
                document.querySelectorAll(".is-masked-during-switch").forEach((node) => {
                    node.classList.remove("is-masked-during-switch");
                });
                const manifest = getProgressiveManifest("settings", targetSection);
                (manifest.masks || []).forEach((selector) => {
                    document.querySelectorAll(selector).forEach((node) => {
                        node.classList.add("is-masked-during-switch");
                    });
                });
                if (typeof manifest.hydrate === "function") {
                    void manifest.hydrate();
                }
            } catch (_error) {
                window.location.assign(nextUrl);
            }
        });

        window.addEventListener("popstate", async () => {
            const state = getState();
            if (state?.currentView !== "settings") return;
            const section = window.location.pathname.split("/")[2] || "about";
            setActiveSettingsNav(section);
            state.settingsSection = section;
            try {
                const responseText = await fetch(window.location.pathname + window.location.search, {
                    credentials: "same-origin",
                    headers: {"X-Requested-With": "settings-popstate"},
                    cache: "force-cache",
                }).then(async (response) => {
                    if (!response.ok) throw new Error(`Settings popstate failed: ${response.status}`);
                    return response.text();
                });
                const parser = new DOMParser();
                const nextDocument = parser.parseFromString(responseText, "text/html");
                const nextRegion = nextDocument.querySelector("#settings_workspace_region");
                if (nextRegion) {
                    await replaceSettingsWorkspaceRegion(nextRegion);
                    reinitializeSettingsWorkspaceRegion();
                    revealStyleTokenHashTarget(window.location.hash);
                }
                const manifest = getProgressiveManifest("settings", section);
                if (typeof manifest.hydrate === "function") {
                    void manifest.hydrate();
                }
            } catch (_error) {
                window.location.assign(window.location.pathname + window.location.search);
            }
        });
    };

    bootstrap.hydrateSettingsNetworkStatuses = hydrateNetworkStatuses;
    bootstrap.hydrateSettingsLocalStoreRanges = hydrateLocalStoreRanges;
    bootstrap.initSettingsWorkspace = (context = {}) => {
        settingsContext = context;
        bootstrap.initThemeModeControls?.();
        attachBrokerSettingsHandlers();
        attachNetworkRefreshButton();
        attachStyleTokenResizer();
        attachStyleTokenDemoResponsiveness();
        attachStyleTokenControls();
        attachStyleTokenReferences();
        attachStyleTokenCopyButtons();
        attachStyleTokenModeSwitches();
        attachStyleTokenDemoInteractions();
        revealStyleTokenHashTarget();
        attachLocalStorePagination();
        attachSettingsSectionNavigation();
    };
})();
