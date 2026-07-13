/* Code version: v0.7.4 */
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
    let activeSettingsSummaryMorphCleanup = null;
    let refreshStyleTokenDemoDensity = null;

    const getStyleTokenShell = () => (
        document.querySelector("[data-export-image-shell]")
        || document.querySelector("[data-style-token-shell]")
    );

    const getStyleTokenApplyTargets = (shell) => {
        if (!(shell instanceof HTMLElement)) return [];
        if (shell.hasAttribute("data-export-image-shell")) {
            return [document.documentElement, shell];
        }
        return [shell];
    };

    const applyStyleTokenProperty = (shell, tokenName, value) => {
        if (!tokenName) return;
        getStyleTokenApplyTargets(shell).forEach((target) => {
            if (target instanceof HTMLElement) {
                target.style.setProperty(tokenName, value);
            }
        });
    };

    const getContext = () => settingsContext || {};
    const getState = () => getContext().state || null;
    const getEndpoints = () => getContext().endpoints || {};
    const getLabels = () => getContext().labels || {};
    const getShortDatePlaceholder = () => {
        const helper = window.ANTIGRAVITY_BOOTSTRAP?.dateDisplay?.getShortDatePlaceholder;
        return typeof helper === "function" ? helper() : "0000/00/00";
    };
    const canTransitionDom = () => Boolean(getContext().canTransitionDom);
    const rememberCurrentViewUrl = (url) => getContext().rememberCurrentViewUrl?.(url);
    const getProgressiveManifest = (view, section = null) => getContext().getProgressiveManifest?.(view, section) || {masks: []};
    const renderOptimisticNavigationSkeleton = (options) => getContext().renderOptimisticNavigationSkeleton?.(options);
    const clearOptimisticNavigationSkeleton = () => getContext().clearOptimisticNavigationSkeleton?.();
    const fetchJsonCached = (...args) => getContext().fetchJsonCached?.(...args);
    let styleTokenQrCodeLibraryPromise = null;
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
        // IBKR Gateway JS removed (Flex Web Service)
    };

    const applyTemplateInlineStyles = () => {
        document.querySelectorAll("[data-inline-font-size-token]").forEach((element) => {
            if (!(element instanceof HTMLElement)) return;
            const token = (element.dataset.inlineFontSizeToken || "").trim();
            if (!token) return;
            const value = token.startsWith("var(") ? token : `var(${token})`;
            element.style.fontSize = value;
        });

        document.querySelectorAll("[data-inline-background]").forEach((element) => {
            if (!(element instanceof HTMLElement)) return;
            const value = (element.dataset.inlineBackground || "").trim();
            if (value) element.style.background = value;
        });

        document.querySelectorAll("[data-inline-backdrop-filter]").forEach((element) => {
            if (!(element instanceof HTMLElement)) return;
            const value = (element.dataset.inlineBackdropFilter || "").trim();
            if (value) element.style.backdropFilter = value;
        });

        document.querySelectorAll("[data-inline-webkit-backdrop-filter]").forEach((element) => {
            if (!(element instanceof HTMLElement)) return;
            const value = (element.dataset.inlineWebkitBackdropFilter || "").trim();
            if (value) element.style.setProperty("-webkit-backdrop-filter", value);
        });

        document.querySelectorAll("[data-inline-border]").forEach((element) => {
            if (!(element instanceof HTMLElement)) return;
            const value = (element.dataset.inlineBorder || "").trim();
            if (value) element.style.border = value;
        });

        document.querySelectorAll("[data-inline-box-shadow]").forEach((element) => {
            if (!(element instanceof HTMLElement)) return;
            const value = (element.dataset.inlineBoxShadow || "").trim();
            if (value) element.style.boxShadow = value;
        });
    };

    const attachSettingsSummaryMorph = () => {
        if (typeof activeSettingsSummaryMorphCleanup === "function") {
            activeSettingsSummaryMorphCleanup();
            activeSettingsSummaryMorphCleanup = null;
        }
        const summaryCard = document.querySelector(".settings-workspace-header > .settings-summary-card");
        const workspaceRegion = document.querySelector("[data-settings-workspace-region]");
        const settingsSection = (workspaceRegion instanceof HTMLElement ? workspaceRegion.dataset.settingsSection : "").trim();
        const sidebar = document.getElementById("app_sidebar");
        if (!(summaryCard instanceof HTMLElement) || !(sidebar instanceof HTMLElement)) return;
        if (settingsSection === "strategies") {
            summaryCard.style.removeProperty("--settings-summary-morph-translate-x");
            summaryCard.style.removeProperty("--settings-summary-morph-translate-y");
            summaryCard.style.removeProperty("--settings-summary-morph-scale-x");
            summaryCard.style.removeProperty("--settings-summary-morph-scale-y");
            return;
        }
        summaryCard.classList.add("workspace-article-card", "workspace-summary-card");
        const mobileMedia = window.matchMedia("(max-width: 767px)");
        let frameId = 0;
        let resizeObserver = null;
        const clearMorph = () => {
            summaryCard.style.removeProperty("--settings-summary-morph-translate-x");
            summaryCard.style.removeProperty("--settings-summary-morph-translate-y");
            summaryCard.style.removeProperty("--settings-summary-morph-scale-x");
            summaryCard.style.removeProperty("--settings-summary-morph-scale-y");
        };
        const syncMorph = () => {
            frameId = 0;
            if (!mobileMedia.matches) {
                clearMorph();
                return;
            }
            const summaryRect = summaryCard.getBoundingClientRect();
            if (!(summaryRect.width > 0) || !(summaryRect.height > 0)) {
                clearMorph();
                return;
            }
            const sidebarRect = sidebar.getBoundingClientRect();
            const sidebarStyles = window.getComputedStyle(sidebar);
            const targetLeft = Number.parseFloat(sidebarStyles.left || "") || sidebarRect.left;
            const targetTop = Number.parseFloat(sidebarStyles.top || "") || sidebarRect.top;
            const targetBottom = Number.parseFloat(sidebarStyles.bottom || "") || 0;
            const targetWidth = sidebarRect.width > 0 ? sidebarRect.width : Math.max(1, window.innerWidth - (targetLeft * 2));
            const targetHeight = Math.max(1, window.innerHeight - targetTop - targetBottom);
            summaryCard.style.setProperty("--settings-summary-morph-translate-x", `${targetLeft - summaryRect.left}px`);
            summaryCard.style.setProperty("--settings-summary-morph-translate-y", `${targetTop - summaryRect.top}px`);
            summaryCard.style.setProperty("--settings-summary-morph-scale-x", `${targetWidth / summaryRect.width}`);
            summaryCard.style.setProperty("--settings-summary-morph-scale-y", `${targetHeight / summaryRect.height}`);
        };
        const scheduleMorphSync = () => {
            if (frameId) return;
            frameId = window.requestAnimationFrame(syncMorph);
        };
        scheduleMorphSync();
        window.addEventListener("resize", scheduleMorphSync);
        if (window.visualViewport) window.visualViewport.addEventListener("resize", scheduleMorphSync);
        if (typeof mobileMedia.addEventListener === "function") {
            mobileMedia.addEventListener("change", scheduleMorphSync);
        } else if (typeof mobileMedia.addListener === "function") {
            mobileMedia.addListener(scheduleMorphSync);
        }
        if (typeof ResizeObserver === "function") {
            resizeObserver = new ResizeObserver(scheduleMorphSync);
            resizeObserver.observe(summaryCard);
            resizeObserver.observe(sidebar);
        }
        activeSettingsSummaryMorphCleanup = () => {
            if (frameId) window.cancelAnimationFrame(frameId);
            window.removeEventListener("resize", scheduleMorphSync);
            if (window.visualViewport) window.visualViewport.removeEventListener("resize", scheduleMorphSync);
            if (typeof mobileMedia.removeEventListener === "function") {
                mobileMedia.removeEventListener("change", scheduleMorphSync);
            } else if (typeof mobileMedia.removeListener === "function") {
                mobileMedia.removeListener(scheduleMorphSync);
            }
            resizeObserver?.disconnect();
            clearMorph();
        };
    };

    const attachStyleTokenResizer = () => {
        const shell = getStyleTokenShell();
        const handle = shell?.querySelector("[data-style-token-resizer]");
        if (typeof activeStyleTokenResizerCleanup === "function") {
            activeStyleTokenResizerCleanup();
            activeStyleTokenResizerCleanup = null;
        }
        if (!(shell instanceof HTMLElement) || !(handle instanceof HTMLElement) || handle.dataset.bound === "1") return;
        handle.dataset.bound = "1";
        const scrollViewport = shell.closest("[data-settings-workspace-region], #settings_workspace_shell");
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
        const shell = getStyleTokenShell();
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

    const refreshStyleTokenPortfolioDonutDemo = () => {
        const shell = getStyleTokenShell();
        if (!(shell instanceof HTMLElement)) return;
        shell.querySelectorAll(".style-token-portfolio-donut-orbit").forEach((orbitElement) => {
            if (!(orbitElement instanceof HTMLElement)) return;
            const computed = getComputedStyle(orbitElement);
            const donutSize = Number.parseFloat(computed.getPropertyValue("--portfolio-donut-orbit-donut-size"))
                || Number.parseFloat(computed.getPropertyValue("--portfolio-donut-size"))
                || 120;
            const logoSize = Number.parseFloat(computed.getPropertyValue("--portfolio-donut-orbit-logo-size"))
                || Number.parseFloat(computed.getPropertyValue("--portfolio-donut-logo-size"))
                || 20;
            const satelliteRadius = (logoSize * Math.SQRT2) / 2;
            const orbitRadius = (donutSize / 2) + satelliteRadius;
            const center = orbitElement.clientWidth / 2;
            orbitElement.querySelectorAll(".portfolio-donut-logo[data-style-token-donut-angle]").forEach((logoElement) => {
                if (!(logoElement instanceof HTMLImageElement)) return;
                const angle = Number.parseFloat(logoElement.dataset.styleTokenDonutAngle || "");
                if (!Number.isFinite(angle)) return;
                const radians = ((angle - 90) * Math.PI) / 180;
                const x = center + (Math.cos(radians) * orbitRadius);
                const y = center + (Math.sin(radians) * orbitRadius);
                logoElement.style.left = `${x.toFixed(2)}px`;
                logoElement.style.top = `${y.toFixed(2)}px`;
            });
        });
    };

    const attachStyleTokenControls = () => {
        const shell = getStyleTokenShell();
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
                applyStyleTokenProperty(shell, tokenName, `${safeValue}${unit}`);
                refreshStyleTokenPortfolioDonutDemo();
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
        const shell = getStyleTokenShell();
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
        const shell = getStyleTokenShell();
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
        const shell = getStyleTokenShell();
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
        const shell = getStyleTokenShell();
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

    const formatStyleTokenShareTimestampHkt = () => {
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

    const ensureStyleTokenQrCodeFactory = async () => {
        if (typeof window.qrcode === "function") return window.qrcode;
        if (styleTokenQrCodeLibraryPromise) return styleTokenQrCodeLibraryPromise;
        styleTokenQrCodeLibraryPromise = new Promise((resolve, reject) => {
            const existingScript = document.querySelector('script[data-settings-style-token-library="qrcode-generator"]');
            if (existingScript) {
                existingScript.addEventListener("load", () => resolve(window.qrcode), {once: true});
                existingScript.addEventListener("error", () => reject(new Error("Failed to load QR renderer.")), {once: true});
                return;
            }
            const script = document.createElement("script");
            script.src = "/static/assets/js/vendor/qrcode-generator.js";
            script.async = true;
            script.dataset.settingsStyleTokenLibrary = "qrcode-generator";
            script.addEventListener("load", () => {
                if (typeof window.qrcode === "function") {
                    resolve(window.qrcode);
                    return;
                }
                reject(new Error("QR renderer loaded without exposing factory."));
            }, {once: true});
            script.addEventListener("error", () => reject(new Error("Failed to load QR renderer.")), {once: true});
            document.head.appendChild(script);
        }).catch((error) => {
            styleTokenQrCodeLibraryPromise = null;
            throw error;
        });
        return styleTokenQrCodeLibraryPromise;
    };

    const buildStyleTokenShareQrSvg = (qrFactory, value) => {
        const qr = qrFactory(0, "M");
        qr.addData(String(value || "").trim());
        qr.make();
        const moduleCount = qr.getModuleCount();
        const margin = 2;
        const viewBoxSize = moduleCount + (margin * 2);
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

    const INVESTMENT_SHARE_PREVIEW_VIEWS = [
        {id: "chart", title: "Overview", subtitle: ""},
        {id: "holdings", title: "Holdings", subtitle: ""},
        {id: "stock_details", title: "Stock details", subtitle: ""},
        {id: "metrics", title: "Metrics", subtitle: ""},
    ];

    const WORKSPACE_SHARE_PREVIEW_VIEWS = [
        {id: "compare", title: "Return comparison", subtitle: ""},
        {id: "portfolio", title: "Portfolio", subtitle: ""},
        {id: "dca", title: "DCA", subtitle: ""},
        {id: "backtest", title: "Backtest", subtitle: ""},
    ];

    const getSharePreviewViewsForDemo = (demoShell) => {
        const group = (demoShell?.dataset?.styleTokenSharePreviewGroup || "investment").trim();
        return group === "workspace" ? WORKSPACE_SHARE_PREVIEW_VIEWS : INVESTMENT_SHARE_PREVIEW_VIEWS;
    };

    const isSharePreviewMaskEnabled = (demoShell) => demoShell?.dataset?.styleTokenShareMaskEnabled === "1";

    const setSharePreviewMaskEnabled = (demoShell, enabled) => {
        if (!(demoShell instanceof HTMLElement)) return;
        demoShell.dataset.styleTokenShareMaskEnabled = enabled ? "1" : "0";
        const maskButton = demoShell.querySelector("[data-style-token-share-mask]");
        if (maskButton instanceof HTMLButtonElement) {
            const label = enabled ? "Show Sensitive Values" : "Mask Sensitive Values";
            maskButton.setAttribute("aria-pressed", enabled ? "true" : "false");
            maskButton.setAttribute("aria-label", label);
            maskButton.title = label;
        }
        const currentIndex = Number.parseInt(demoShell.dataset.styleTokenSharePreviewIndex || "0", 10) || 0;
        applyStyleTokenInvestmentSharePreview(demoShell, currentIndex);
    };

    const calibrateStyleTokenSharePreviewTemplate = (card) => {
        if (!(card instanceof HTMLElement)) return;
        card.dataset.shareTemplate = "stable-v1";
        const footer = card.querySelector(".investment-community-share-footer");
        if (footer instanceof HTMLElement) {
            footer.dataset.shareTemplateFixed = "1";
        }
    };

    const createStyleTokenDemoElement = (tagName, className = "", textContent = null) => {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        if (textContent !== null) element.textContent = textContent;
        return element;
    };

    const createStyleTokenShareDemoSection = (className = "") => createStyleTokenDemoElement(
        "section",
        ["investment-community-share-section", className].filter(Boolean).join(" "),
    );

    const createStyleTokenShareDemoChartSection = (chartKind = "overview") => {
        const section = createStyleTokenShareDemoSection("investment-community-share-section--chart");
        const shell = createStyleTokenDemoElement("div", "investment-community-share-chart-shell style-token-investment-share-chart-shell");
        const canvas = createStyleTokenDemoElement("canvas", "style-token-investment-share-chart-canvas");
        canvas.width = 552;
        canvas.height = 300;
        canvas.setAttribute("aria-hidden", "true");
        canvas.dataset.styleTokenShareChart = chartKind;
        shell.append(canvas);
        section.append(shell);
        return section;
    };

    const createStyleTokenShareDemoDonutSection = () => {
        const section = createStyleTokenShareDemoSection("investment-community-share-section--compact investment-community-share-section--padded");
        const wrap = createStyleTokenDemoElement("div", "investment-community-share-overview-donut");
        const shell = createStyleTokenDemoElement("div", "style-token-portfolio-donut-shell");
        const orbit = createStyleTokenDemoElement("div", "portfolio-donut-orbit style-token-portfolio-donut-orbit");
        orbit.setAttribute("aria-hidden", "true");
        const logoLayer = createStyleTokenDemoElement("div", "portfolio-donut-logo-layer");
        [
            {src: "/static/images/Google__G__logo.svg", angle: "180"},
            {src: "/market-store/logos/EUV.png", angle: "308"},
            {src: "/market-store/logos/IBKR.png", angle: "20"},
        ].forEach(({src, angle}) => {
            const logo = createStyleTokenDemoElement("img", "portfolio-donut-logo");
            logo.src = src;
            logo.alt = "";
            logo.dataset.styleTokenDonutAngle = angle;
            logoLayer.append(logo);
        });
        const donut = createStyleTokenDemoElement("div", "portfolio-donut");
        donut.style.setProperty(
            "--portfolio-donut-fill",
            "conic-gradient(var(--theme-accent-primary) 0deg 140deg, transparent 140deg 142deg, color-mix(in srgb, var(--theme-accent-primary) 40%, var(--theme-accent-secondary) 60%) 142deg 248deg, transparent 248deg 250deg, var(--theme-accent-secondary) 250deg 328deg, transparent 328deg 330deg, color-mix(in srgb, var(--theme-accent-positive) 72%, var(--theme-accent-primary) 28%) 330deg 360deg)",
        );
        orbit.append(logoLayer, donut);
        shell.append(orbit);
        wrap.append(shell);
        section.append(wrap);
        return section;
    };

    const createStyleTokenShareDemoMetricCard = (label, value) => {
        const card = createStyleTokenDemoElement("div", "trade-metric-card trade-metric-card--value-align-end");
        card.append(
            createStyleTokenDemoElement("span", "trade-metric-label", label),
            createStyleTokenDemoElement("span", "trade-metric-value", value),
        );
        return card;
    };

    const createStyleTokenShareDemoMetricsGrid = (items) => {
        const grid = createStyleTokenDemoElement("div", "investment-community-share-metrics-grid");
        items.forEach((item) => {
            grid.append(createStyleTokenShareDemoMetricCard(item.label, item.value));
        });
        return grid;
    };

    const createStyleTokenShareDemoStockIdentity = () => {
        const section = createStyleTokenShareDemoSection("investment-community-share-section--compact investment-community-share-section--padded");
        const identity = createStyleTokenDemoElement("div", "ticker-identity-item is-active style-token-investment-share-stock-identity");
        const row = createStyleTokenDemoElement("div", "ticker-identity-row");
        const logo = createStyleTokenDemoElement("img", "ticker-identity-logo");
        logo.src = "/market-store/logos/NVDA.png";
        logo.alt = "";
        const copy = createStyleTokenDemoElement("span", "ticker-identity-copy");
        copy.append(
            createStyleTokenDemoElement("span", "suggestion-symbol ticker-identity-symbol", "NVDA"),
            createStyleTokenDemoElement("span", "suggestion-name ticker-identity-name", "NVIDIA Corporation"),
        );
        row.append(logo, copy);
        identity.append(row);
        section.append(identity);
        return section;
    };

    const getShareHoldingsMetricValueParts = (value) => {
        const rawValue = String(value ?? "").trim() || "--";
        const numericMatch = rawValue.match(/^([+\-]?(?:[A-Z]{3}\s|\$)?)(\d[\d,]*)(?:\.(\d+))(%?)$/);
        if (!numericMatch) {
            return [{className: "workspace-metric-value-major", text: rawValue}];
        }
        const [, prefix, integerPart, decimalPart = "", suffix = ""] = numericMatch;
        if (!decimalPart) {
            return [{className: "workspace-metric-value-major", text: `${prefix}${integerPart}${suffix}`}];
        }
        return [
            {className: "workspace-metric-value-major", text: `${prefix}${integerPart}.`},
            {className: "workspace-metric-value-minor", text: decimalPart},
            ...(suffix ? [{className: "workspace-metric-value-suffix", text: suffix}] : []),
        ];
    };

    const createShareHoldingsMetricValueCell = (value) => {
        const displayText = String(value || "").trim() || "-";
        let toneClass = "";
        if (displayText.startsWith("+")) toneClass = " investment-holdings-value-positive";
        else if (displayText.startsWith("-") && displayText !== "-") toneClass = " investment-holdings-value-negative";
        const cell = createStyleTokenDemoElement("td", "investment-holdings-cell investment-holdings-cell-money");
        const metric = createStyleTokenDemoElement(
            "span",
            `trade-metric-value investment-stock-details-metric-value investment-holdings-live-value${toneClass}`.trim(),
        );
        getShareHoldingsMetricValueParts(displayText).forEach((part) => {
            metric.append(createStyleTokenDemoElement("span", part.className, part.text));
        });
        cell.append(metric);
        return cell;
    };

    const createStyleTokenShareDemoHoldingsSection = ({maskSensitive = false} = {}) => {
        const section = createStyleTokenShareDemoSection("investment-community-share-section--chart investment-community-share-table-shell");
        const shell = createStyleTokenDemoElement("div", "investment-holdings-table-shell");
        const visibleColumns = maskSensitive
            ? ["Ticker", "Weight", "Avg cost", "Last"]
            : ["Ticker", "Weight", "Shares", "Avg cost", "Last", "P&L"];
        const createTickerCellContent = (ticker, companyName) => {
            const wrapper = createStyleTokenDemoElement("div", "suggestion-item timing-suggestion-item ticker-identity-item investment-holdings-ticker-link");
            wrapper.dataset.ticker = ticker;
            const row = createStyleTokenDemoElement("div", "ticker-identity-row");
            const logo = createStyleTokenDemoElement("img", "ticker-identity-logo");
            logo.src = `/market-store/logos/${ticker}.png`;
            logo.alt = "";
            logo.loading = "lazy";
            logo.decoding = "async";
            const copy = createStyleTokenDemoElement("span", "ticker-identity-copy");
            copy.append(
                createStyleTokenDemoElement("span", "suggestion-symbol ticker-identity-symbol", ticker),
                createStyleTokenDemoElement("span", "suggestion-name ticker-identity-name", companyName),
            );
            row.append(logo, copy);
            wrapper.append(row);
            return wrapper;
        };
        const table = createStyleTokenDemoElement(
            "table",
            "settings-table trade-transactions-table scrollable-data-table investment-holdings-table investment-community-share-holdings-table",
        );
        const thead = createStyleTokenDemoElement("thead");
        const headerRow = createStyleTokenDemoElement("tr");
        visibleColumns.forEach((label) => {
            headerRow.append(createStyleTokenDemoElement("th", "", label));
        });
        const summaryRow = createStyleTokenDemoElement("tr", "investment-holdings-summary-row");
        const summaryLabel = createStyleTokenDemoElement("th", "investment-holdings-summary-copy", "Summary");
        summaryLabel.colSpan = visibleColumns.length;
        summaryRow.append(summaryLabel);
        thead.append(headerRow, summaryRow);
        const tbody = createStyleTokenDemoElement("tbody");
        [
            {ticker: "NVDA", company: "NVIDIA Corporation", values: {weight: "31.8%", shares: "180", avgCost: "118.40", last: "133.92", pnl: "+2,793.60"}},
            {ticker: "EUV", company: "VanEck Semiconductor ETF", values: {weight: "22.4%", shares: "320", avgCost: "42.18", last: "48.96", pnl: "+2,169.60"}},
            {ticker: "GOOGL", company: "Alphabet Inc.", values: {weight: "16.1%", shares: "96", avgCost: "168.20", last: "176.30", pnl: "+777.60"}},
            {ticker: "MSFT", company: "Microsoft Corporation", values: {weight: "14.5%", shares: "74", avgCost: "412.30", last: "428.14", pnl: "+1,172.16"}},
            {ticker: "TSM", company: "Taiwan Semiconductor", values: {weight: "9.2%", shares: "578", avgCost: "24.12", last: "22.88", pnl: "-716.72"}},
        ].forEach((row) => {
            const tr = createStyleTokenDemoElement("tr");
            const tickerCell = createStyleTokenDemoElement("td");
            tickerCell.append(createTickerCellContent(row.ticker, row.company));
            tr.append(tickerCell);
            const orderedValues = maskSensitive
                ? [row.values.weight, row.values.avgCost, row.values.last]
                : [row.values.weight, row.values.shares, row.values.avgCost, row.values.last, row.values.pnl];
            orderedValues.forEach((value) => tr.append(createShareHoldingsMetricValueCell(value)));
            tbody.append(tr);
        });
        table.append(thead, tbody);
        shell.append(table);
        section.append(shell);
        return section;
    };

    const createStyleTokenShareDemoCompareHeadingSection = () => {
        const section = createStyleTokenShareDemoSection("investment-community-share-section--compact investment-community-share-section--padded");
        const card = createStyleTokenDemoElement(
            "article",
            "report-card workspace-article-card workspace-summary-card compare-share-heading-card",
        );
        const headingRow = createStyleTokenDemoElement("div", "report-heading-row");
        headingRow.append(createStyleTokenDemoElement("p", "report-heading", "Performance summary"));
        card.append(headingRow);
        section.append(card);
        return section;
    };

    const createStyleTokenShareDemoCompareSummarySection = () => {
        const appendComparePercentValue = (node, value) => {
            const match = String(value || "—").match(/^(.+)(\.)(\d{2})(%)$/);
            if (!match) {
                node.append(createStyleTokenDemoElement("span", "compare-percent-empty", value || "—"));
                return;
            }
            [
                ["compare-percent-major", match[1]],
                ["compare-percent-dot", match[2]],
                ["compare-percent-minor", match[3]],
                ["compare-percent-suffix", match[4]],
            ].forEach(([className, text]) => node.append(createStyleTokenDemoElement("span", className, text)));
        };
        const section = createStyleTokenShareDemoSection("investment-community-share-section--compact investment-community-share-section--padded");
        const card = createStyleTokenDemoElement("article", "report-card workspace-content-card compare-summary-content-card compare-share-summary-card");
        const panel = createStyleTokenDemoElement("div", "", null);
        panel.id = "compare_summary_panel";
        panel.append(createStyleTokenDemoElement("p", "compare-summary-date-range", "11 Feb 2010 - 18 Jun 2026"));
        const grid = createStyleTokenDemoElement("div", "performance-grid");
        grid.id = "compare_summary_region";
        [
            {ticker: "TQQQ", company: "ProShares UltraPro QQQ", value: "284.62%", ttmYield: "0.00%", color: "#0055cc", isWinner: true},
            {ticker: "NVDA", company: "NVIDIA Corporation", value: "42.18%", ttmYield: "0.03%", color: "#16a34a"},
            {ticker: "GOOGL", company: "Alphabet Inc.", value: "28.64%", ttmYield: "0.46%", color: "#f59e0b", isDividendWinner: true},
        ].forEach((item) => {
            const performanceItem = createStyleTokenDemoElement("section", "performance-item");
            performanceItem.dataset.ticker = item.ticker;
            const row = createStyleTokenDemoElement("div", "ticker-identity-row");
            const logo = createStyleTokenDemoElement("img", "ticker-identity-logo");
            logo.src = `/market-store/logos/${item.ticker}.png`;
            logo.alt = "";
            const copy = createStyleTokenDemoElement("span", "ticker-identity-copy");
            copy.append(
                createStyleTokenDemoElement("span", "suggestion-symbol ticker-identity-symbol", item.ticker),
                createStyleTokenDemoElement("span", "suggestion-name ticker-identity-name", item.company),
            );
            row.append(logo, copy);
            const metrics = createStyleTokenDemoElement("div", "performance-metrics");
            const value = createStyleTokenDemoElement("p", "report-value performance-metric-row performance-metric-row-total");
            const valueSpan = createStyleTokenDemoElement("span", "compare-percent-value", "");
            valueSpan.style.color = item.color;
            appendComparePercentValue(valueSpan, item.value);
            value.append(valueSpan);
            if (item.isWinner) {
                const winnerBadge = createStyleTokenDemoElement("img", "winner-badge");
                winnerBadge.src = "/static/images/checkmark.circle.fill.green.svg";
                winnerBadge.alt = "";
                winnerBadge.setAttribute("role", "img");
                winnerBadge.setAttribute("aria-label", "Winner");
                value.append(winnerBadge);
            }
            const yieldRow = createStyleTokenDemoElement("p", "report-value performance-metric-row performance-metric-row-dividend");
            const yieldSpan = createStyleTokenDemoElement("span", "compare-percent-value compare-percent-value-secondary", "");
            appendComparePercentValue(yieldSpan, item.ttmYield);
            yieldRow.append(yieldSpan);
            if (item.isDividendWinner) {
                const winnerBadge = createStyleTokenDemoElement("img", "winner-badge");
                winnerBadge.src = "/static/images/checkmark.circle.fill.green.svg";
                winnerBadge.alt = "";
                winnerBadge.setAttribute("role", "img");
                winnerBadge.setAttribute("aria-label", "Winner");
                yieldRow.append(winnerBadge);
            }
            metrics.append(value, yieldRow);
            performanceItem.append(row, metrics);
            grid.append(performanceItem);
        });
        panel.append(grid);
        card.append(panel);
        section.append(card);
        return section;
    };

    const createStyleTokenShareDemoPortfolioSummarySection = () => {
        const section = createStyleTokenShareDemoSection("investment-community-share-section--compact investment-community-share-section--padded");
        const card = createStyleTokenDemoElement("article", "report-card workspace-content-card portfolio-summary-content-card portfolio-share-summary-card");
        const summary = createStyleTokenDemoElement("div", "portfolio-summary");
        const main = createStyleTokenDemoElement("div", "portfolio-summary-main");
        main.append(
            createStyleTokenDemoElement("p", "portfolio-total-label", "Total return"),
            createStyleTokenDemoElement("p", "portfolio-total-value", "36.42%"),
        );
        summary.append(main);
        card.append(summary);
        section.append(card);
        return section;
    };

    const createStyleTokenShareDemoTradeMetricsSection = () => {
        const section = createStyleTokenShareDemoSection("investment-community-share-section--chart investment-community-share-section--padded");
        const grid = createStyleTokenShareDemoMetricsGrid([
            {label: "Total return", value: "36.42%"},
            {label: "CAGR", value: "18.6%"},
            {label: "Max drawdown", value: "-12.4%"},
            {label: "Sharpe", value: "1.42"},
        ]);
        grid.classList.add("workspace-share-metrics-card");
        section.append(grid);
        return section;
    };

    const createStyleTokenShareDemoTradeChartSection = (chartKind = "price") => {
        const section = createStyleTokenShareDemoSection("investment-community-share-section--chart workspace-share-section--trade-chart");
        const shell = createStyleTokenDemoElement("div", "investment-community-share-chart-shell style-token-investment-share-chart-shell");
        const canvas = createStyleTokenDemoElement("canvas", "style-token-investment-share-chart-canvas");
        canvas.width = 552;
        canvas.height = chartKind === "equity" ? 180 : 120;
        canvas.setAttribute("aria-hidden", "true");
        canvas.dataset.styleTokenShareChart = chartKind;
        shell.append(canvas);
        section.append(shell);
        return section;
    };

    const createStyleTokenSharePreviewBody = (viewId, {maskSensitive = false, previewGroup = "investment"} = {}) => {
        if (previewGroup === "workspace") {
            switch (viewId) {
                case "portfolio":
                    return [
                        createStyleTokenShareDemoChartSection("overview"),
                        createStyleTokenShareDemoPortfolioSummarySection(),
                    ];
                case "dca":
                case "backtest":
                    return [
                        createStyleTokenShareDemoTradeMetricsSection(),
                        createStyleTokenShareDemoTradeChartSection("price"),
                        createStyleTokenShareDemoTradeChartSection("equity"),
                    ];
                case "compare":
                default:
                    return [
                        createStyleTokenShareDemoCompareHeadingSection(),
                        createStyleTokenShareDemoCompareSummarySection(),
                        createStyleTokenShareDemoChartSection("overview"),
                    ];
            }
        }
        switch (viewId) {
            case "holdings":
                return [createStyleTokenShareDemoHoldingsSection({maskSensitive})];
            case "stock_details": {
                const metricsSection = createStyleTokenShareDemoSection("investment-community-share-section--compact investment-community-share-section--padded");
                metricsSection.classList.add("investment-stock-details-metrics");
                metricsSection.append(createStyleTokenShareDemoMetricsGrid([
                    {label: "Last", value: "$ 1,248.60"},
                    {label: "Day", value: "+2.81%"},
                    {label: "Shares", value: "180"},
                    {label: "Market value", value: "$ 224,748"},
                ]));
                return [
                    createStyleTokenShareDemoStockIdentity(),
                    createStyleTokenShareDemoChartSection("stock_details"),
                    metricsSection,
                ];
            }
            case "metrics": {
                const metricsSection = createStyleTokenShareDemoSection("investment-community-share-section--chart investment-community-share-section--padded");
                metricsSection.append(createStyleTokenShareDemoMetricsGrid([
                    {label: "Total equity", value: "$ 1,401,220"},
                    {label: "Cumulative P&L", value: "+$ 182,340"},
                    {label: "Realized P&L", value: "+$ 76,180"},
                    {label: "Unrealized P&L", value: "+$ 106,160"},
                    {label: "Commission", value: "-$ 4,218"},
                    {label: "Interest", value: "-$ 628"},
                ]));
                return [metricsSection];
            }
            case "chart":
            default:
                return [
                    createStyleTokenShareDemoChartSection("overview"),
                    createStyleTokenShareDemoDonutSection(),
                ];
        }
    };

    const renderStyleTokenShareQrs = async () => {
        const qrShells = Array.from(document.querySelectorAll("[data-style-token-share-qr]"))
            .filter((element) => element instanceof HTMLElement);
        if (!qrShells.length) return;
        try {
            const qrFactory = await ensureStyleTokenQrCodeFactory();
            qrShells.forEach((shell) => {
                const value = (shell.dataset.styleTokenShareQr || "").trim();
                if (!value) return;
                shell.replaceChildren(buildStyleTokenShareQrSvg(qrFactory, value));
            });
        } catch (_error) {
        }
    };

    const readStyleTokenShareSafePaddingPx = (cardStyles, rootStyles) => {
        const raw = cardStyles.getPropertyValue("--investment-community-share-safe-padding").trim()
            || rootStyles.getPropertyValue("--investment-community-share-safe-padding").trim()
            || cardStyles.getPropertyValue("--investment-community-share-card-padding").trim()
            || rootStyles.getPropertyValue("--investment-community-share-card-padding").trim()
            || "10px";
        const value = Number.parseFloat(raw);
        return Number.isFinite(value) ? value : 10;
    };

    const drawStyleTokenInvestmentShareChart = (canvas) => {
        if (!(canvas instanceof HTMLCanvasElement)) return;
        const context = canvas.getContext("2d");
        if (!context) return;
        const dpr = Math.max(window.devicePixelRatio || 1, 1);
        const cssWidth = canvas.clientWidth || Number.parseFloat(canvas.getAttribute("width") || "") || 552;
        const cssHeight = canvas.clientHeight || Number.parseFloat(canvas.getAttribute("height") || "") || 300;
        canvas.width = Math.round(cssWidth * dpr);
        canvas.height = Math.round(cssHeight * dpr);
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.scale(dpr, dpr);
        context.clearRect(0, 0, cssWidth, cssHeight);

        const card = canvas.closest(".investment-community-share-card") || document.documentElement;
        const cardStyles = window.getComputedStyle(card);
        const rootStyles = window.getComputedStyle(document.documentElement);
        const safePadding = readStyleTokenShareSafePaddingPx(cardStyles, rootStyles);
        const accent = cardStyles.getPropertyValue("--investment-community-share-accent").trim()
            || rootStyles.getPropertyValue("--investment-community-share-accent").trim()
            || "#0055cc";
        const textMuted = cardStyles.getPropertyValue("--theme-muted").trim()
            || rootStyles.getPropertyValue("--theme-muted").trim()
            || "rgba(31, 41, 55, 0.62)";
        const bodyText = cardStyles.getPropertyValue("--text").trim()
            || rootStyles.getPropertyValue("--text").trim()
            || "#111827";
        const chartKind = (canvas.dataset.styleTokenShareChart || "overview").trim();
        const isOverviewStyleChart = chartKind === "overview";
        const labelFontSize = isOverviewStyleChart
            ? 23
            : Math.max(
                Number.parseFloat(cardStyles.getPropertyValue("--font-form-label"))
                || Number.parseFloat(rootStyles.getPropertyValue("--font-form-label"))
                || 14,
                14,
            );
        const labelFontWeight = isOverviewStyleChart
            ? "400"
            : (cardStyles.getPropertyValue("--font-weight-semibold").trim()
                || rootStyles.getPropertyValue("--font-weight-semibold").trim()
                || "600");
        const labelFontFamily = isOverviewStyleChart
            ? '"GDS Transport", "Helvetica Neue", Arial, sans-serif'
            : (cardStyles.fontFamily || rootStyles.fontFamily || "system-ui");
        const labelFont = `${labelFontWeight} ${labelFontSize}px ${labelFontFamily}`;
        const isStockDetailsChart = chartKind === "stock_details";
        const isTradePriceChart = chartKind === "price";
        const isTradeEquityChart = chartKind === "equity";
        const data = isStockDetailsChart
            ? [998, 1004, 1012, 1026, 1048, 1064, 1088, 1120, 1108, 1142, 1178, 1214, 1248]
            : isTradePriceChart
                ? [182.4, 184.1, 183.2, 186.8, 188.4, 191.2, 189.6, 193.8, 196.4, 198.2, 201.6, 204.8]
                : isTradeEquityChart
                    ? [100000, 101200, 100800, 103400, 105600, 104200, 107800, 110400, 112600, 115200, 118400, 121800]
                    : [26800, 26850, 26790, 27120, 27860, 27410, 27080, 27240, 27300, 26940, 26220, 26650, 27640, 29120, 29540, 29880, 30220, 30610, 30420, 31250, 36120, 34080, 35610, 38920];
        const minValue = isStockDetailsChart
            ? 960
            : isTradePriceChart
                ? 180
                : isTradeEquityChart
                    ? 99000
                    : 26000;
        const maxValue = isStockDetailsChart
            ? 1280
            : isTradePriceChart
                ? 208
                : isTradeEquityChart
                    ? 124000
                    : 39000;
        const yAxisValues = isStockDetailsChart
            ? [1240, 1180, 1120, 1060, 1000]
            : isTradePriceChart
                ? [204, 198, 192, 186, 180]
                : isTradeEquityChart
                    ? [120000, 115000, 110000, 105000, 100000]
                    : [38000, 36000, 34000, 32000, 30000, 28000];
        const xAxisLabels = isStockDetailsChart
            ? ["1 Apr 2026", "16 May 2026", "18 Jun 2026"]
            : ["1 Jan 2026", "27 Mar 2026", "18 Jun 2026"];

        context.font = labelFont;
        const formatShareChartAxisValue = (value) => value.toLocaleString("en-US");
        const yAxisLabelWidth = Math.max(
            ...yAxisValues.map((value) => context.measureText(formatShareChartAxisValue(value)).width),
            0,
        );
        const yAxisGutter = Math.ceil(yAxisLabelWidth) + safePadding;
        const xAxisLineHeight = Math.round(labelFontSize * 1.08);
        const xAxisBlockHeight = isOverviewStyleChart
            ? (xAxisLineHeight * 2) + safePadding
            : (isStockDetailsChart ? 24 : 34);
        const padding = {
            top: safePadding + 6,
            right: safePadding,
            bottom: xAxisBlockHeight,
            left: yAxisGutter,
        };
        const plotWidth = cssWidth - padding.left - padding.right;
        const plotHeight = cssHeight - padding.top - padding.bottom;

        context.fillStyle = textMuted;
        context.textBaseline = "middle";
        yAxisValues.forEach((value) => {
            const ratio = (value - minValue) / (maxValue - minValue);
            const y = padding.top + plotHeight - (ratio * plotHeight);
            context.textAlign = "right";
            context.fillText(formatShareChartAxisValue(value), padding.left - safePadding, y);
        });

        context.textBaseline = "top";
        if (isOverviewStyleChart) {
            const xAxisTicks = [
                {line1: "11/02", line2: "2010", align: "left", x: padding.left},
                {line1: "27/03", line2: "2026", align: "center", x: padding.left + (plotWidth * 0.52)},
                {line1: "18/06", line2: "2026", align: "right", x: cssWidth - safePadding},
            ];
            const xAxisTop = cssHeight - safePadding - xAxisBlockHeight + Math.max(0, (xAxisBlockHeight - (xAxisLineHeight * 2)) / 2);
            xAxisTicks.forEach(({line1, line2, align, x}) => {
                context.textAlign = align;
                context.fillText(line1, x, xAxisTop);
                context.fillText(line2, x, xAxisTop + xAxisLineHeight);
            });
        } else {
            context.textBaseline = "alphabetic";
            context.textAlign = "left";
            context.fillText(xAxisLabels[0], padding.left, cssHeight - safePadding);
            context.textAlign = "center";
            context.fillText(xAxisLabels[1], padding.left + (plotWidth * 0.52), cssHeight - safePadding);
            context.textAlign = "right";
            context.fillText(xAxisLabels[2], cssWidth - safePadding, cssHeight - safePadding);
        }

        context.strokeStyle = accent;
        context.lineWidth = isOverviewStyleChart ? 2.0 : 4;
        context.lineJoin = "round";
        context.lineCap = "round";
        context.beginPath();
        data.forEach((value, index) => {
            const x = padding.left + ((plotWidth / (data.length - 1)) * index);
            const ratio = (value - minValue) / (maxValue - minValue);
            const y = padding.top + plotHeight - (ratio * plotHeight);
            if (index === 0) {
                context.moveTo(x, y);
                return;
            }
            context.lineTo(x, y);
        });
        context.stroke();

        context.fillStyle = bodyText;
        context.beginPath();
        const lastIndex = data.length - 1;
        const lastX = padding.left + ((plotWidth / lastIndex) * lastIndex);
        const lastY = padding.top + plotHeight - (((data[lastIndex] - minValue) / (maxValue - minValue)) * plotHeight);
        context.arc(lastX, lastY, 4, 0, Math.PI * 2);
        context.fill();
    };

    const applyStyleTokenInvestmentSharePreview = (demoShell, nextIndex = 0) => {
        if (!(demoShell instanceof HTMLElement)) return;
        const previewViews = getSharePreviewViewsForDemo(demoShell);
        if (!previewViews.length) return;
        const previewGroup = (demoShell.dataset.styleTokenSharePreviewGroup || "investment").trim();
        const maskSensitive = isSharePreviewMaskEnabled(demoShell);
        const normalizedIndex = ((nextIndex % previewViews.length) + previewViews.length) % previewViews.length;
        const currentView = previewViews[normalizedIndex];
        const card = demoShell.querySelector("[data-style-token-share-preview-card]");
        if (!(card instanceof HTMLElement)) return;
        const title = card.querySelector(".investment-community-share-title");
        const subtitle = card.querySelector("[data-style-token-share-subtitle]");
        const body = card.querySelector(".investment-community-share-body");
        const viewLabel = demoShell.querySelector("[data-style-token-share-view-label]");
        if (!(title instanceof HTMLElement) || !(body instanceof HTMLElement) || !(viewLabel instanceof HTMLElement)) return;
        calibrateStyleTokenSharePreviewTemplate(card);
        demoShell.dataset.styleTokenSharePreviewIndex = String(normalizedIndex);
        demoShell.dataset.styleTokenSharePreviewView = currentView.id;
        card.dataset.shareView = currentView.id;
        card.setAttribute("aria-label", `${currentView.title} community share template`);
        title.textContent = previewGroup === "workspace" ? currentView.title : "Overview";
        viewLabel.textContent = currentView.title;
        if (subtitle instanceof HTMLElement) {
            subtitle.textContent = currentView.subtitle;
            subtitle.hidden = !currentView.subtitle;
        }
        card.classList.toggle("is-share-sensitive-masked", maskSensitive);
        body.replaceChildren(...createStyleTokenSharePreviewBody(currentView.id, {maskSensitive, previewGroup}));
        refreshStyleTokenPortfolioDonutDemo();
        body.querySelectorAll("[data-style-token-share-chart]").forEach((canvas) => {
            drawStyleTokenInvestmentShareChart(canvas);
        });
    };

    const bindStyleTokenInvestmentSharePreviewControls = () => {
        document.querySelectorAll("[data-style-token-share-demo]").forEach((demoShell) => {
            if (!(demoShell instanceof HTMLElement)) return;
            if (demoShell.dataset.styleTokenSharePreviewBound === "1") {
                applyStyleTokenInvestmentSharePreview(
                    demoShell,
                    Number.parseInt(demoShell.dataset.styleTokenSharePreviewIndex || "0", 10) || 0,
                );
                return;
            }
            demoShell.dataset.styleTokenSharePreviewBound = "1";
            demoShell.querySelectorAll("[data-style-token-share-nav]").forEach((button) => {
                if (!(button instanceof HTMLButtonElement)) return;
                button.addEventListener("click", () => {
                    const now = Date.now();
                    const lastNavigationAt = Number.parseInt(demoShell.dataset.styleTokenSharePreviewLastNavigationAt || "0", 10) || 0;
                    if (now - lastNavigationAt < 120) return;
                    demoShell.dataset.styleTokenSharePreviewLastNavigationAt = String(now);
                    const delta = button.dataset.styleTokenShareNav === "prev" ? -1 : 1;
                    const currentIndex = Number.parseInt(demoShell.dataset.styleTokenSharePreviewIndex || "0", 10) || 0;
                    applyStyleTokenInvestmentSharePreview(demoShell, currentIndex + delta);
                });
            });
            const maskButton = demoShell.querySelector("[data-style-token-share-mask]");
            if (maskButton instanceof HTMLButtonElement && maskButton.dataset.bound !== "1") {
                maskButton.dataset.bound = "1";
                maskButton.addEventListener("click", () => {
                    setSharePreviewMaskEnabled(demoShell, !isSharePreviewMaskEnabled(demoShell));
                });
            }
            applyStyleTokenInvestmentSharePreview(
                demoShell,
                Number.parseInt(demoShell.dataset.styleTokenSharePreviewIndex || "0", 10) || 0,
            );
        });
    };

    const seedExportImageTokenDefaults = () => {
        const shell = getStyleTokenShell();
        if (!(shell instanceof HTMLElement) || !shell.hasAttribute("data-export-image-shell")) return;
        shell.querySelectorAll("[data-style-token-control]").forEach((control) => {
            if (!(control instanceof HTMLElement)) return;
            const tokenName = control.dataset.styleTokenName || "";
            const unit = control.dataset.styleTokenUnit || "";
            const numericValue = Number.parseInt(control.dataset.styleTokenValue || "", 10);
            if (!tokenName || !Number.isFinite(numericValue)) return;
            applyStyleTokenProperty(shell, tokenName, `${numericValue}${unit}`);
        });
    };

    const renderStyleTokenInvestmentSharePreview = () => {
        bindStyleTokenInvestmentSharePreviewControls();
        document.querySelectorAll("[data-style-token-share-timestamp]").forEach((element) => {
            if (!(element instanceof HTMLElement)) return;
            element.textContent = formatStyleTokenShareTimestampHkt();
        });
        document.querySelectorAll("[data-style-token-share-preview-card] [data-style-token-share-chart]").forEach((canvas) => {
            drawStyleTokenInvestmentShareChart(canvas);
        });
        void renderStyleTokenShareQrs();
    };

    const syncLocalStorePagination = (currentShell, nextShell) => {
        if (!(currentShell instanceof HTMLElement) || !(nextShell instanceof HTMLElement)) return;
        const currentPagination = currentShell.querySelector("[data-local-store-pagination]");
        const nextPagination = nextShell.querySelector("[data-local-store-pagination]");
        if (!(currentPagination instanceof HTMLElement) && !(nextPagination instanceof HTMLElement)) return;
        if (!(currentPagination instanceof HTMLElement) && nextPagination instanceof HTMLElement) {
            currentShell.append(nextPagination.cloneNode(true));
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

    const syncLocalStoreRegion = (currentShell, nextShell) => {
        if (!(currentShell instanceof HTMLElement) || !(nextShell instanceof HTMLElement)) return;
        const currentSummary = currentShell.querySelector(".settings-summary");
        const nextSummary = nextShell.querySelector(".settings-summary");
        if (currentSummary instanceof HTMLElement && nextSummary instanceof HTMLElement) {
            currentSummary.replaceWith(nextSummary.cloneNode(true));
        }
        const currentTableWrap = currentShell.querySelector(".local-store-table-wrap");
        const nextTableWrap = nextShell.querySelector(".local-store-table-wrap");
        if (currentTableWrap instanceof HTMLElement && nextTableWrap instanceof HTMLElement) {
            currentTableWrap.replaceWith(nextTableWrap.cloneNode(true));
        }
        const currentMaintainForm = currentShell.querySelector(".local-store-maintain-card form");
        const nextMaintainForm = nextShell.querySelector(".local-store-maintain-card form");
        if (currentMaintainForm instanceof HTMLFormElement && nextMaintainForm instanceof HTMLFormElement) {
            const currentPageInput = currentMaintainForm.querySelector('input[name="page"]');
            const nextPageInput = nextMaintainForm.querySelector('input[name="page"]');
            if (currentPageInput instanceof HTMLInputElement && nextPageInput instanceof HTMLInputElement) {
                currentPageInput.value = nextPageInput.value;
            }
        }
        syncLocalStorePagination(currentShell, nextShell);
    };

    const replaceLocalStoreRegion = (nextShell) => {
        const currentShell = document.getElementById("settings_workspace_shell");
        if (!(currentShell instanceof HTMLElement) || !nextShell) return;
        syncLocalStoreRegion(currentShell, nextShell);
    };

    const replaceSettingsWorkspaceRegion = async (nextRegion) => {
        const currentRegion = document.getElementById("settings_workspace_shell");
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
        const compactPlaceholder = getShortDatePlaceholder();
        const article = document.createElement("section");
        article.className = "workspace-header settings-workspace-header settings-shell-local-market-store";
        article.id = "settings_workspace_shell";
        article.dataset.settingsWorkspaceRegion = "";
        article.dataset.settingsSection = "local-market-store";
        article.innerHTML = `
			<article class="report-card workspace-article-card workspace-summary-card settings-summary-card">
				<div class="report-heading-row">
					<p class="report-heading">${labels.local_market_store || "Local Market Store"}</p>
				</div>
			</article>
			<section class="settings-action-package settings-callout-card-primary local-store-maintain-card">
				<span class="settings-nav-icon-shell settings-action-package-icon-shell settings-callout-icon-shell" aria-hidden="true"><span class="icon icon-store-maintain"></span></span>
				<div class="settings-action-package-copy settings-callout-text">
					<p class="settings-service-note">${labels.local_store_maintain_note || ""}</p>
				</div>
				<span class="settings-inline-button settings-inline-button-primary is-pending" aria-hidden="true">${labels.local_store_maintain_button || "Maintain all data"}</span>
			</section>
			<p class="settings-summary">${labels.local_store_summary || ""}</p>
			<div class="scrollable-data-table-shell local-store-table-shell" id="local_store_region" data-local-store-region>
				<table class="settings-table local-store-table scrollable-data-table" aria-hidden="true">
					<colgroup>
						<col class="local-store-col-index">
						<col class="local-store-col-ticker">
						<col class="local-store-col-range">
						<col class="local-store-col-update">
						<col class="local-store-col-1m">
						<col class="local-store-col-delete">
					</colgroup>
					<thead>
						<tr>
							<th class="local-store-col-index">No.</th>
							<th>Ticker</th>
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
							<col class="local-store-col-ticker">
							<col class="local-store-col-range">
							<col class="local-store-col-update">
							<col class="local-store-col-1m">
							<col class="local-store-col-delete">
						</colgroup>
						<tbody>
						${Array.from({length: 6}, (_, index) => `
							<tr data-local-store-ticker="pending-${index + 1}">
								<td class="local-store-index-cell is-pending-value" data-workspace-mask="metric-value">${startIndex + index + 1}</td>
								<td class="local-store-ticker-cell">
									<div class="ticker-identity-item">
										<div class="ticker-identity-row">
											<span class="ticker-identity-copy">
												<span class="suggestion-symbol ticker-identity-symbol is-pending-value" data-workspace-mask="company-name">TICK</span>
												<span class="suggestion-name ticker-identity-name is-pending-value" data-workspace-mask="company-name">Loading</span>
											</span>
										</div>
									</div>
								</td>
								<td class="local-store-range-cell">
									<span class="local-store-range-value">
										<span class="local-store-range-token is-pending-value" data-workspace-mask="local-store-date" data-local-store-range="start">${compactPlaceholder}</span>
										<span class="local-store-range-separator"> - </span>
										<span class="local-store-range-token is-pending-value" data-workspace-mask="local-store-date" data-local-store-range="end">${compactPlaceholder}</span>
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
        const nextShell = nextDocument.querySelector("#settings_workspace_shell");
        if (!nextShell) throw new Error("Settings workspace shell missing from response.");
        replaceLocalStoreRegion(nextShell);
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
            renderOptimisticNavigationSkeleton({view: "settings", section: targetSection});
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
                const nextRegion = nextDocument.querySelector("#settings_workspace_shell");
                if (!nextRegion) throw new Error("Settings workspace region missing.");
                await replaceSettingsWorkspaceRegion(nextRegion);
                clearOptimisticNavigationSkeleton();
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
            renderOptimisticNavigationSkeleton({view: "settings", section});
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
                const nextRegion = nextDocument.querySelector("#settings_workspace_shell");
                if (nextRegion) {
                    await replaceSettingsWorkspaceRegion(nextRegion);
                    clearOptimisticNavigationSkeleton();
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

    const attachLanguageMappingHandlers = () => {
        const form = document.querySelector("[data-settings-language-form]");
        if (!(form instanceof HTMLFormElement) || form.dataset.boundLanguageMapping === "1") return;
        form.dataset.boundLanguageMapping = "1";
        const actionInput = form.querySelector("[data-language-action-input]");
        const uploadTrigger = form.querySelector("[data-language-upload-trigger]");
        const uploadInput = form.querySelector("[data-language-upload-input]");
        const saveButton = form.querySelector("[data-language-save-button]");
        const saveFeedback = form.querySelector("[data-language-save-feedback]");
        const languageInputs = Array.from(form.querySelectorAll('tbody input[type="text"][name^="translation_"]'))
            .filter((input) => input instanceof HTMLInputElement);

        const setSaveFeedback = (message, state = "") => {
            if (!(saveFeedback instanceof HTMLElement)) return;
            const text = String(message || "").trim();
            saveFeedback.textContent = text;
            saveFeedback.hidden = !text;
            saveFeedback.classList.toggle("is-success", state === "success");
            saveFeedback.classList.toggle("is-error", state === "error");
        };

        const syncLanguageDirtyState = (input) => {
            if (!(input instanceof HTMLInputElement)) return false;
            const baseline = input.dataset.languageInitialValue ?? "";
            const isDirty = input.value !== baseline;
            input.classList.toggle("is-dirty", isDirty);
            input.closest("tr")?.classList.toggle("is-dirty-row", isDirty);
            return isDirty;
        };

        const syncAllLanguageDirtyStates = () => {
            let hasDirty = false;
            languageInputs.forEach((input) => {
                hasDirty = syncLanguageDirtyState(input) || hasDirty;
            });
            return hasDirty;
        };

        const clearLanguageDirtyState = () => {
            languageInputs.forEach((input) => {
                if (!(input instanceof HTMLInputElement)) return;
                input.dataset.languageInitialValue = input.value;
                input.classList.remove("is-dirty");
                input.closest("tr")?.classList.remove("is-dirty-row");
            });
        };

        const setSavePending = (isPending) => {
            if (saveButton instanceof HTMLButtonElement) {
                saveButton.disabled = isPending;
                saveButton.classList.toggle("is-pending", isPending);
                saveButton.setAttribute("aria-busy", String(isPending));
                if (isPending) {
                    saveButton.dataset.languageSaveLabel = saveButton.dataset.languageSaveLabel || saveButton.textContent || "Save translations";
                    saveButton.textContent = "Saving...";
                } else {
                    saveButton.textContent = saveButton.dataset.languageSaveLabel || "Save translations";
                    saveButton.removeAttribute("aria-busy");
                }
            }
        };

        languageInputs.forEach((input) => {
            if (!(input instanceof HTMLInputElement)) return;
            input.dataset.languageInitialValue = input.value;
            input.addEventListener("input", () => {
                syncLanguageDirtyState(input);
                if (saveFeedback instanceof HTMLElement && !saveFeedback.hidden && saveFeedback.classList.contains("is-success")) {
                    setSaveFeedback("", "");
                }
            });
            input.addEventListener("change", () => {
                syncLanguageDirtyState(input);
            });
        });

        if (uploadTrigger instanceof HTMLButtonElement && uploadInput instanceof HTMLInputElement) {
            uploadTrigger.addEventListener("click", () => {
                uploadInput.click();
            });
            uploadInput.addEventListener("change", () => {
                if (!uploadInput.files || uploadInput.files.length === 0) return;
                if (actionInput instanceof HTMLInputElement) actionInput.value = "upload";
                form.submit();
            });
        }
        form.addEventListener("submit", async (event) => {
            if (actionInput instanceof HTMLInputElement && actionInput.value !== "upload") {
                actionInput.value = "save";
                event.preventDefault();
                const hadDirtyFields = syncAllLanguageDirtyStates();
                setSaveFeedback(hadDirtyFields ? "Saving translations..." : "Saving translations...", "");
                setSavePending(true);
                try {
                    const response = await fetch(form.action, {
                        method: "POST",
                        body: new FormData(form),
                        headers: {
                            "Accept": "application/json",
                            "X-Settings-Async": "1",
                        },
                    });
                    const payload = await response.json().catch(() => null);
                    if (!response.ok || !payload?.success) {
                        throw new Error(payload?.notice || `Language save failed: ${response.status}`);
                    }
                    clearLanguageDirtyState();
                    setSaveFeedback(payload.notice || "Translations saved.", "success");
                } catch (_error) {
                    setSaveFeedback("Unable to save translations right now.", "error");
                } finally {
                    setSavePending(false);
                }
            }
        });

        const panels = Array.from(form.querySelectorAll("[data-language-panel]"))
            .filter((panel) => panel instanceof HTMLElement);
        const tabs = Array.from(form.querySelectorAll("[data-language-tab]"))
            .filter((tab) => tab instanceof HTMLButtonElement);
        const tabShell = form.querySelector(".settings-language-tabs");
        const setActiveTab = (targetName) => {
            tabs.forEach((tab, index) => {
                const isActive = tab.dataset.languageTab === targetName;
                tab.classList.toggle("is-active", isActive);
                tab.setAttribute("aria-selected", String(isActive));
                if (isActive && tabShell instanceof HTMLElement) {
                    tabShell.style.setProperty("--language-tab-index", String(index));
                }
            });
            panels.forEach((panel) => {
                const isActive = panel.dataset.languagePanel === targetName;
                panel.classList.toggle("is-active", isActive);
                panel.hidden = !isActive;
            });
        };
        tabs.forEach((tab) => {
            tab.addEventListener("click", () => {
                setActiveTab(tab.dataset.languageTab || "current");
            });
        });

        const renderPagination = (pagination, body, page) => {
            if (!(pagination instanceof HTMLElement) || !(body instanceof HTMLElement)) return;
            const rows = Array.from(body.querySelectorAll("[data-language-row]"))
                .filter((row) => row instanceof HTMLTableRowElement);
            const pageSize = Math.max(Number.parseInt(body.dataset.languagePageSize || "10", 10) || 10, 1);
            const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
            const currentPage = Math.min(Math.max(page, 1), totalPages);
            rows.forEach((row, index) => {
                const rowPage = Math.floor(index / pageSize) + 1;
                row.hidden = rowPage !== currentPage;
            });
            if (totalPages <= 1) {
                pagination.innerHTML = "";
                pagination.style.removeProperty("--local-store-pagination-slots");
                return;
            }
            const groupStart = (Math.floor((currentPage - 1) / 5) * 5) + 1;
            const pageCount = Math.min(5, totalPages - groupStart + 1);
            const pageSlots = Array.from({length: pageCount}, (_, index) => {
                const pageNumber = groupStart + index;
                return {label: String(pageNumber), page: pageNumber};
            });
            const slots = totalPages > 5
                ? [
                    {label: "‹", page: groupStart > 1 ? groupStart - 5 : null},
                    ...pageSlots,
                    {label: "›", page: groupStart + 5 <= totalPages ? groupStart + 5 : null},
                ]
                : pageSlots;
            pagination.style.setProperty("--local-store-pagination-slots", String(slots.length));
            pagination.innerHTML = `<span class="local-store-pagination-indicator" aria-hidden="true"></span>${
                slots.map((slot) => {
                    if (!slot.page) {
                        return `<span class="local-store-page-button local-store-page-placeholder" aria-hidden="true"></span>`;
                    }
                    const active = slot.page === currentPage;
                    return `<button type="button" class="local-store-page-button${active ? " is-active" : ""}" data-language-page="${slot.page}" data-pagination-current="${active ? "1" : "0"}"${active ? " aria-current=\"page\"" : ""}>${slot.label}</button>`;
                }).join("")
            }`;
            pagination.querySelectorAll("[data-language-page]").forEach((button) => {
                button.addEventListener("click", () => {
                    const nextPage = Number.parseInt(button.dataset.languagePage || "1", 10) || 1;
                    renderPagination(pagination, body, nextPage);
                });
            });
            const activeButton = pagination.querySelector(".local-store-page-button.is-active");
            if (activeButton instanceof HTMLElement) {
                pagination.classList.add("is-animated");
                const indicator = pagination.querySelector(".local-store-pagination-indicator");
                if (indicator instanceof HTMLElement) {
                    const buttonRect = activeButton.getBoundingClientRect();
                    const paginationRect = pagination.getBoundingClientRect();
                    indicator.style.transform = `translate3d(${buttonRect.left - paginationRect.left}px, ${buttonRect.top - paginationRect.top}px, 0)`;
                }
            }
        };

        form.querySelectorAll("[data-language-pagination]").forEach((pagination) => {
            if (!(pagination instanceof HTMLElement)) return;
            const panelName = pagination.dataset.languagePagination || "current";
            const panel = form.querySelector(`[data-language-panel="${panelName}"]`);
            const body = panel?.querySelector("[data-language-paginated-body]");
            if (body instanceof HTMLElement) renderPagination(pagination, body, 1);
        });
    };

    bootstrap.hydrateSettingsNetworkStatuses = hydrateNetworkStatuses;
    bootstrap.hydrateSettingsLocalStoreRanges = hydrateLocalStoreRanges;
    bootstrap.initSettingsWorkspace = (context = {}) => {
        settingsContext = context;
        bootstrap.initThemeModeControls?.();
        applyTemplateInlineStyles();
        refreshStyleTokenPortfolioDonutDemo();
        seedExportImageTokenDefaults();
        renderStyleTokenInvestmentSharePreview();
        attachBrokerSettingsHandlers();
        attachNetworkRefreshButton();
        attachSettingsSummaryMorph();
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
        attachLanguageMappingHandlers();
        attachCashEquivalentsHandlers();
    };

    function attachCashEquivalentsAddActionPosition() {
        const actionShell = document.getElementById('cash_equivalents_add_action_shell');
        const headingRow = document.querySelector('.settings-workspace-header > .settings-summary-card .report-heading-row');
        if (!(actionShell instanceof HTMLElement)) return;
        if (!(headingRow instanceof HTMLElement)) return;
        if (actionShell.dataset.cashPositionBound === '1') return;
        actionShell.dataset.cashPositionBound = '1';

        let frameId = 0;
        const syncPosition = () => {
            frameId = 0;
            const rect = headingRow.getBoundingClientRect();
            if (!rect.height) return;
            const centerY = rect.top + (rect.height / 2);
            actionShell.style.setProperty('--cash-equivalents-add-top', `${centerY}px`);
            actionShell.style.top = `${centerY}px`;
        };
        const schedulePositionSync = () => {
            if (frameId) return;
            frameId = window.requestAnimationFrame(syncPosition);
        };

        schedulePositionSync();
        window.addEventListener('resize', schedulePositionSync);
        window.addEventListener('scroll', schedulePositionSync, true);
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', schedulePositionSync);
            window.visualViewport.addEventListener('scroll', schedulePositionSync);
        }
        if (typeof ResizeObserver === 'function') {
            const resizeObserver = new ResizeObserver(schedulePositionSync);
            resizeObserver.observe(headingRow);
        }
    }

    function attachCashEquivalentsHandlers() {
        const listEl = document.getElementById('cash_equivalents_list');
        const addBtn = document.getElementById('add_ticker');
        attachCashEquivalentsAddActionPosition();
        if (!listEl || !addBtn) return;
        if (addBtn.dataset.cashBound === '1') return;
        addBtn.dataset.cashBound = '1';

        const form = document.getElementById('cash_equiv_form');

        function postUpdate(tickers) {
            // Use fetch to update without hard reload if possible, fallback to form
            fetch('/settings/cash-equivalents/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ action: 'set', tickers: (tickers || []).join(',') })
            }).then(() => {
                window.location.reload();
            }).catch(() => {
                if (form) {
                    form.action = '/settings/cash-equivalents/action';
                    const act = form.querySelector('input[name="action"]');
                    if (act) act.value = 'set';
                    // append tickers
                    form.querySelectorAll('input[name="ticker"]').forEach(el => el.remove());
                    (tickers || []).forEach(t => {
                        const i = document.createElement('input');
                        i.type = 'hidden';
                        i.name = 'ticker';
                        i.value = t;
                        form.appendChild(i);
                    });
                    form.submit();
                } else {
                    window.location.reload();
                }
            });
        }

        function getCurrentTickers() {
            return Array.from(listEl.querySelectorAll('.cash-equivalent-row[data-ticker]'))
                .map(r => r.dataset.ticker)
                .filter(Boolean);
        }

        listEl.addEventListener('click', (ev) => {
            const btn = ev.target.closest('.cash-equiv-remove, .ticker-remove');
            if (!btn || !listEl.contains(btn)) return;
            ev.preventDefault();
            const ticker = btn.dataset.ticker || '';
            if (!ticker) return;
            const next = getCurrentTickers().filter(t => t !== ticker);
            postUpdate(next);
        });

        addBtn.addEventListener('click', (ev) => {
            ev.preventDefault();
            if (listEl.querySelector('.cash-equiv-add-row')) return; // only one editor
            const row = document.createElement('div');
            row.className = 'cash-equiv-add-row ticker-input-row';
            row.innerHTML = `
                <div class="ticker-input-main">
                    <label style="font-size: var(--font-form-label);">Add ticker</label>
                    <div class="ticker-input-control">
                        <span class="ticker-leading-slot" aria-hidden="true">
                            <span class="ticker-logo-placeholder"></span>
                            <img class="ticker-input-logo" alt="" hidden>
                        </span>
                        <input class="settings-form-control" data-ticker-input placeholder="e.g. BOXX" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="latin" style="padding-left:44px;">
                        <button type="button" class="ticker-clear" aria-label="Clear"><span class="icon icon-remove-muted" aria-hidden="true"></span></button>
                    </div>
                </div>
                <button type="button" class="ticker-remove cash-equiv-cancel-add" aria-label="Cancel add"><span class="icon icon-remove-muted" aria-hidden="true"></span></button>
            `;
            listEl.appendChild(row);
            const input = row.querySelector('input[data-ticker-input]');
            const cancel = row.querySelector('.cash-equiv-cancel-add');
            if (cancel) cancel.addEventListener('click', () => row.remove());

            const finishAdd = () => {
                const val = (input.value || '').trim().toUpperCase();
                if (!val) {
                    row.remove();
                    return;
                }
                const current = getCurrentTickers();
                if (current.includes(val)) {
                    row.remove();
                    return;
                }
                postUpdate([...current, val]);
            };

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    finishAdd();
                } else if (e.key === 'Escape') {
                    row.remove();
                }
            });
            input.addEventListener('blur', () => {
                // delay to allow click other
                setTimeout(() => {
                    if (row.parentNode) finishAdd();
                }, 120);
            });
            setTimeout(() => input.focus(), 0);

            // try to hook global ticker sync for logo if available
            try {
                if (typeof window.syncTickerIdentityState === 'function') {
                    input.addEventListener('input', () => {
                        window.syncTickerIdentityState(input);
                    });
                }
            } catch (_) {}
        });

        // basic ticker sync for initial rows if logos missing
        listEl.querySelectorAll('input[data-ticker-input]').forEach(inp => {
            // no-op for static
        });
    }
})();
