/* Code version: v0.25.1 */

import {
    buildSettingsUrl,
    parseSettingsUrlState,
} from './settings/url-state.js?v=settings-url-state-v0.2.0';
import {
    createSettingsStyleTokenController,
} from './settings/style-token-controller.js?v=settings-style-token-controller-v1.0.0';

(() => {
    const bootstrap = window.WORTHWARD_BOOTSTRAP = window.WORTHWARD_BOOTSTRAP || {};
    let settingsContext = null;
    let localStorePaginationRequest = null;
    let localStorePaginationRequestGeneration = 0;
    let localStorePaginationReadyListener = null;
    let pendingLocalStorePaginationAnimation = null;
    let didBindSettingsSectionNavigation = false;
    let didBindLocalStorePagination = false;
    let didBindColorTokenGlobalEvents = false;
    let activeLongbridgeOauthMonitorCleanup = null;

    const getContext = () => settingsContext || {};
    const getState = () => getContext().state || null;
    const getEndpoints = () => getContext().endpoints || {};
    const getLabels = () => getContext().labels || {};
    const getLanguageState = () => window.WORTHWARD_APP?.language || {};
    const translateUi = (value) => {
        const languageState = getLanguageState();
        const languageCode = String(languageState.code || "en");
        if (languageCode === "en") return value;
        const row = Array.isArray(languageState.translations)
            ? languageState.translations.find((candidate) => candidate?.en === value)
            : null;
        return row?.[languageCode] || value;
    };
    const getShortDatePlaceholder = () => {
        const helper = window.WORTHWARD_BOOTSTRAP?.dateDisplay?.getShortDatePlaceholder;
        return typeof helper === "function" ? helper() : "0000/00/00";
    };
    const setActionPackageLiveState = (packageElement, isLive) => {
        if (!(packageElement instanceof HTMLElement)) return;
        const nextLiveState = Boolean(isLive);
        packageElement.dataset.actionPackageLive = nextLiveState ? "true" : "false";
        packageElement.querySelectorAll("[data-action-package-live-marker]").forEach((marker) => {
            if (!(marker instanceof HTMLElement)) return;
            marker.hidden = !nextLiveState;
        });
    };
    const setActionPackagePresentation = (packageElement, {pending = false} = {}) => {
        if (!(packageElement instanceof HTMLElement)) return;
        const copy = packageElement.querySelector("[data-action-package-copy]");
        if (copy instanceof HTMLElement) {
            const nextCopy = pending
                ? packageElement.dataset.actionPackagePendingCopy
                : packageElement.dataset.actionPackageDefaultCopy;
            if (nextCopy) copy.textContent = nextCopy;
        }
        const button = packageElement.querySelector("[data-action-package-button]");
        if (button instanceof HTMLButtonElement) {
            const nextLabel = pending ? button.dataset.pendingLabel : button.dataset.defaultLabel;
            if (nextLabel) button.textContent = nextLabel;
            button.disabled = pending;
            button.classList.toggle("is-pending", pending);
            button.toggleAttribute("aria-busy", pending);
        }
    };
    const canTransitionDom = () => Boolean(getContext().canTransitionDom);
    const rememberCurrentViewUrl = (url) => getContext().rememberCurrentViewUrl?.(url);
    const getSettingsCurrentUrl = () => (
        `${window.location.pathname}${window.location.search}${window.location.hash}`
    );
    const canonicalizeSettingsUrl = () => {
        const currentState = parseSettingsUrlState(window.location.href);
        const nextUrl = buildSettingsUrl(window.location.href, currentState);
        if (getSettingsCurrentUrl() !== nextUrl) {
            window.history.replaceState(window.history.state, "", nextUrl);
            rememberCurrentViewUrl(nextUrl);
        }
        return parseSettingsUrlState(nextUrl);
    };
    const syncSettingsUrl = ({section, tab, page, historyMode = "replace"} = {}) => {
        const currentState = parseSettingsUrlState(window.location.href);
        const nextUrl = buildSettingsUrl(window.location.href, {
            section: section ?? currentState.section,
            tab: tab ?? currentState.tab,
            page: page ?? currentState.page,
        });
        if (getSettingsCurrentUrl() === nextUrl) return nextUrl;
        const historyState = {
            settings: true,
            section: section ?? currentState.section,
            tab: tab ?? currentState.tab,
            page: page ?? currentState.page,
        };
        if (historyMode === "push") window.history.pushState(historyState, "", nextUrl);
        else window.history.replaceState(historyState, "", nextUrl);
        const state = getState();
        if (state) state.settingsSection = historyState.section;
        if (window.WORTHWARD_APP) {
            window.WORTHWARD_APP.settingsTab = historyState.tab;
            window.WORTHWARD_APP.settingsPage = historyState.page;
        }
        rememberCurrentViewUrl(nextUrl);
        return nextUrl;
    };
    const getProgressiveManifest = (view, section = null) => getContext().getProgressiveManifest?.(view, section) || {masks: []};
    const renderOptimisticNavigationSkeleton = (options) => getContext().renderOptimisticNavigationSkeleton?.(options);
    const clearOptimisticNavigationSkeleton = () => getContext().clearOptimisticNavigationSkeleton?.();
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
        const syncBrokerFields = () => {
            const selectedBroker = brokerSelect.value.trim().toLowerCase();
            document.querySelectorAll("[data-broker-fields]").forEach((fieldGroup) => {
                if (!(fieldGroup instanceof HTMLElement)) return;
                fieldGroup.hidden = fieldGroup.dataset.brokerFields !== selectedBroker;
            });
        };
        brokerSelect.addEventListener("change", syncBrokerFields);
        syncBrokerFields();
    };

    const attachLongbridgeOauthMonitor = () => {
        const monitor = document.querySelector("[data-longbridge-oauth-monitor]");
        if (monitor instanceof HTMLElement && monitor.dataset.bound === "1") return;
        if (typeof activeLongbridgeOauthMonitorCleanup === "function") {
            activeLongbridgeOauthMonitorCleanup();
            activeLongbridgeOauthMonitorCleanup = null;
        }

        if (!(monitor instanceof HTMLElement)) return;
        const statusUrl = (monitor.dataset.statusUrl || "").trim();
        if (!statusUrl) return;
        monitor.dataset.bound = "1";

        let intervalId = 0;
        let requestInFlight = false;
        let stopped = false;
        let successDismissTimer = 0;
        let consecutiveFetchFailures = 0;
        // Only transport or JSON-decoding failures retry; JSON status responses are terminal service states.
        const maxTransientFetchFailures = 3;

        const stop = () => {
            if (stopped) return;
            stopped = true;
            if (intervalId) window.clearInterval(intervalId);
            if (successDismissTimer) window.clearTimeout(successDismissTimer);
            window.removeEventListener("focus", checkStatus);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };

        const updateFeedback = (status, message) => {
            const isSuccess = status === "success";
            const healthIndicator = document.querySelector("[data-broker-connection-health]");
            const healthSummary = document.querySelector("[data-broker-connection-summary]");
            if (healthIndicator instanceof HTMLElement) healthIndicator.hidden = !isSuccess;
            if (healthSummary instanceof HTMLElement) {
                healthSummary.textContent = isSuccess
                    ? translateUi("The broker is connected and ready. You can still test detailed connection parameters, including latency. This does not place any order.")
                    : translateUi("Try the current broker authentication against the selected service and report whether it works. This only verifies connectivity and does not place any order.");
            }
            const feedback = document.querySelector("[data-broker-test-feedback]");
            if (feedback instanceof HTMLElement) {
                feedback.hidden = false;
                feedback.classList.toggle("is-success", isSuccess);
                feedback.classList.toggle("is-error", !isSuccess);
                feedback.replaceChildren();
                if (isSuccess) {
                    const icon = document.createElement("span");
                    icon.className = "settings-broker-test-feedback-icon";
                    icon.setAttribute("aria-hidden", "true");
                    feedback.append(icon);
                }
                const copy = document.createElement("span");
                copy.textContent = message;
                feedback.append(copy);
            }

            const banner = document.querySelector(".notice-floating-banner-global");
            if (!(banner instanceof HTMLElement)) return;
            banner.classList.toggle("notice", isSuccess);
            banner.classList.toggle("error", !isSuccess);
            const heading = banner.querySelector(".notice-floating-banner-heading");
            const copy = banner.querySelector(".notice-floating-banner-copy");
            const icon = banner.querySelector(".notice-floating-banner-icon");
            if (heading instanceof HTMLElement) heading.textContent = isSuccess ? translateUi("Connected") : translateUi("Connection issue");
            if (copy instanceof HTMLElement) copy.textContent = message;
            if (icon instanceof HTMLElement && isSuccess) icon.classList.add("icon-settings-broker");
            if (isSuccess) {
                successDismissTimer = window.setTimeout(() => {
                    if (banner.isConnected) banner.hidden = true;
                }, 6000);
            }
        };

        async function checkStatus() {
            if (stopped || requestInFlight || !monitor.isConnected) return;
            requestInFlight = true;
            try {
                const response = await fetch(statusUrl, {
                    credentials: "same-origin",
                    headers: {"Accept": "application/json"},
                    cache: "no-store",
                });
                const payload = await response.json();
                const status = String(payload?.status || "error").trim().toLowerCase();
                consecutiveFetchFailures = 0;
                if (status === "pending") return;
                const message = String(payload?.message || translateUi("Longbridge authorization status is unavailable.")).trim();
                stop();
                updateFeedback(status, message);
            } catch {
                consecutiveFetchFailures += 1;
                if (consecutiveFetchFailures < maxTransientFetchFailures) return;
                stop();
                updateFeedback(
                    "error",
                    translateUi("Longbridge authorization status checks could not reach this app after 3 attempts. Check your local connection, then authorize again."),
                );
            } finally {
                requestInFlight = false;
            }
        }

        function handleVisibilityChange() {
            if (document.visibilityState === "visible") void checkStatus();
        }

        window.addEventListener("focus", checkStatus);
        document.addEventListener("visibilitychange", handleVisibilityChange);
        intervalId = window.setInterval(checkStatus, 1500);
        activeLongbridgeOauthMonitorCleanup = stop;
        void checkStatus();
    };

    const {
        applyTemplateInlineStyles,
        attachSettingsSummaryMorph,
        attachStyleTokenActionPackageLiveControl,
        attachStyleTokenControls,
        attachStyleTokenCopyButtons,
        attachStyleTokenDemoInteractions,
        attachStyleTokenDemoResponsiveness,
        attachStyleTokenModeSwitches,
        attachStyleTokenPaginationDemos,
        attachStyleTokenReferences,
        attachStyleTokenResizer,
        attachStyleTokenTableFilterDemos,
        attachTextInputClearHandlers,
        refreshStyleTokenPortfolioDonutDemo,
        renderStyleTokenInvestmentSharePreview,
        revealStyleTokenHashTarget,
        seedExportImageTokenDefaults,
    } = createSettingsStyleTokenController({
        setActionPackageLiveState,
        setActionPackagePresentation,
        translateUi,
        writeTextToClipboard,
    });
    const attachLocalStoreMaintainAction = () => {
        const actionPackage = document.querySelector(".local-store-maintain-card");
        if (!(actionPackage instanceof HTMLElement) || actionPackage.dataset.bound === "1") return;
        const form = actionPackage.querySelector("form");
        if (!(form instanceof HTMLFormElement)) return;
        actionPackage.dataset.bound = "1";
        form.addEventListener("submit", () => {
            const action = form.querySelector('input[name="action"]');
            if (!(action instanceof HTMLInputElement) || action.value !== "maintain") return;
            setActionPackageLiveState(actionPackage, true);
            setActionPackagePresentation(actionPackage, {pending: true});
        });
    };

    const syncLocalStorePagination = (currentShell, nextShell) => {
        if (!(currentShell instanceof HTMLElement) || !(nextShell instanceof HTMLElement)) return;
        const currentTableShell = currentShell.querySelector("[data-local-store-region]");
        const nextTableShell = nextShell.querySelector("[data-local-store-region]");
        if (!(currentTableShell instanceof HTMLElement) || !(nextTableShell instanceof HTMLElement)) return;
        currentTableShell.classList.toggle(
            "has-floating-pagination",
            nextTableShell.classList.contains("has-floating-pagination"),
        );
        const currentPagination = currentTableShell.querySelector("[data-local-store-pagination]");
        const nextPagination = nextTableShell.querySelector("[data-local-store-pagination]");
        if (!(currentPagination instanceof HTMLElement) && !(nextPagination instanceof HTMLElement)) return;
        if (!(currentPagination instanceof HTMLElement) && nextPagination instanceof HTMLElement) {
            currentTableShell.append(nextPagination.cloneNode(true));
            return;
        }
        if (currentPagination instanceof HTMLElement && !(nextPagination instanceof HTMLElement)) {
            currentPagination.remove();
            return;
        }
        if (!(currentPagination instanceof HTMLElement) || !(nextPagination instanceof HTMLElement)) return;
        currentPagination.setAttribute("aria-label", nextPagination.getAttribute("aria-label") || translateUi("Local market store pages"));
        [
            "aria-controls",
            "data-pagination-scroll-target",
            "data-pagination-page-count",
            "data-pagination-current-page",
            "data-pagination-compact",
            "style",
        ].forEach((attributeName) => {
            const nextValue = nextPagination.getAttribute(attributeName);
            if (nextValue === null) currentPagination.removeAttribute(attributeName);
            else currentPagination.setAttribute(attributeName, nextValue);
        });
        const indicator = currentPagination.querySelector(".local-store-pagination-indicator");
        Array.from(currentPagination.childNodes).forEach((node) => {
            if (node !== indicator) node.remove();
        });
        Array.from(nextPagination.childNodes).forEach((node) => {
            if (node instanceof HTMLElement && node.classList.contains("local-store-pagination-indicator")) return;
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
						<p class="report-heading">${labels.local_market_store || translateUi("Local market store")}</p>
				</div>
			</article>
			<section class="settings-action-package settings-callout-card-primary local-store-maintain-card" data-action-package-live="true">
				<span class="settings-nav-icon-shell settings-action-package-icon-shell settings-callout-icon-shell" aria-hidden="true"><span class="icon icon-store-maintain"></span></span>
				<div class="settings-action-package-copy settings-callout-text">
						<p class="settings-service-name"><span class="settings-action-package-live-marker" data-action-package-live-marker role="img" aria-label="${labels.local_store_maintain_live_marker || translateUi("Live maintenance is active")}" title="${labels.local_store_maintain_live_marker || translateUi("Live maintenance is active")}"></span>${labels.local_store_maintain_title || translateUi("Maintain all data")}</p>
						<p class="settings-service-note" data-action-package-copy>${labels.local_store_maintain_pending_note || translateUi("Refreshing all cached daily datasets and protected brand assets. Keep this page open while maintenance is in progress.")}</p>
				</div>
				<span class="settings-inline-button settings-inline-button-primary is-pending" aria-hidden="true">${labels.local_store_maintain_pending_button || translateUi("Maintaining")}</span>
			</section>
			<p class="settings-summary">${labels.local_store_summary || ""}</p>
				<div class="scrollable-data-table-shell local-store-pagination-host local-store-table-shell" id="local_store_region" data-local-store-region>
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
								<th class="local-store-col-index">${translateUi("No.")}</th>
								<th>${translateUi("Ticker")}</th>
								<th>${labels.local_store_range || translateUi("Range")}</th>
							<th>1d</th>
							<th>${labels.local_store_intraday || "1m"}</th>
							<th>${labels.local_store_delete || ""}</th>
						</tr>
					</thead>
				</table>
					<div class="settings-table-wrap local-store-table-wrap scrollable-data-table-scroll" id="local_store_table_scroll">
					<table class="settings-table local-store-table scrollable-data-table">
						<colgroup>
							<col class="local-store-col-index">
							<col class="local-store-col-ticker">
							<col class="local-store-col-range">
							<col class="local-store-col-update">
							<col class="local-store-col-1m">
							<col class="local-store-col-delete">
						</colgroup>
							<tbody id="local_store_table_body">
						${Array.from({length: 6}, (_, index) => `
							<tr data-local-store-ticker="pending-${index + 1}">
								<td class="local-store-index-cell is-pending-value" data-workspace-mask="metric-value">${startIndex + index + 1}</td>
								<td class="local-store-ticker-cell">
									<div class="ticker-identity-item">
										<div class="ticker-identity-row">
											<span class="ticker-identity-copy">
												<span class="suggestion-symbol ticker-identity-symbol is-pending-value" data-workspace-mask="company-name">TICK</span>
													<span class="suggestion-name ticker-identity-name is-pending-value" data-workspace-mask="company-name">${translateUi("Loading")}</span>
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
								<td><span class="settings-action-button is-pending" aria-hidden="true"><span class="suggestion-loading-spinner"></span></span></td>
								<td><span class="settings-action-button is-pending" aria-hidden="true"><span class="suggestion-loading-spinner"></span></span></td>
								<td><span class="settings-action-button is-danger is-pending" aria-hidden="true"><span class="suggestion-loading-spinner"></span></span></td>
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
        const transportNode = document.querySelector("[data-network-transport]");
        if (summaryCheckedAtNode instanceof HTMLElement) summaryCheckedAtNode.textContent = `${translateUi("Last checked:")} ${translateUi("Checking...")}`;
        if (transportNode instanceof HTMLElement) transportNode.textContent = translateUi("Running independent checks from the application host...");
        document.querySelectorAll("[data-settings-service-row]").forEach((row) => {
            const statusNode = row.querySelector("[data-settings-service-status]");
            const noteNode = row.querySelector("[data-settings-service-note]");
            const checkedAtNode = row.querySelector("[data-settings-service-checked-at]");
            const iconNode = row.querySelector("[data-settings-service-icon]");
            const stateNode = row.querySelector(".settings-service-state");
            if (statusNode instanceof HTMLElement) statusNode.textContent = translateUi("Checking...");
            if (iconNode instanceof HTMLElement) {
                iconNode.classList.remove("is-visible");
                iconNode.classList.add("is-pending-status", "suggestion-loading-spinner");
            }
            if (stateNode instanceof HTMLElement) stateNode.classList.add("is-muted");
            if (noteNode instanceof HTMLElement) {
                const pendingNote = noteNode.dataset.pendingNote || "";
                if (pendingNote) noteNode.textContent = pendingNote;
            }
            if (checkedAtNode instanceof HTMLElement) checkedAtNode.textContent = `${translateUi("Last checked:")} ${translateUi("Checking...")}`;
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
            const transportNode = document.querySelector("[data-network-transport]");
            const firstCheckedAtText = payload?.rows?.[0]?.checked_at_text || "";
            if (summaryCheckedAtNode instanceof HTMLElement) {
                summaryCheckedAtNode.textContent = firstCheckedAtText || `${translateUi("Last checked:")} ${translateUi("Not checked yet.")}`;
            }
            if (transportNode instanceof HTMLElement && payload?.transport_note) {
                transportNode.textContent = payload.transport_note;
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
                    iconNode.classList.remove("is-pending-status", "suggestion-loading-spinner");
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

    const buildLocalStorePageHref = (pageValue) => {
        return buildSettingsUrl(window.location.href, {
            section: "local-market-store",
            page: pageValue,
        });
    };

    const supersedeLocalStorePaginationRequest = () => {
        localStorePaginationRequestGeneration += 1;
        localStorePaginationRequest = null;
    };

    const initLocalStorePaginationPhysics = ({animationState = null} = {}) => {
        const pagination = document.querySelector("[data-local-store-pagination]");
        if (!(pagination instanceof HTMLElement)) return;
        const paginationApi = window.WORTHWARD_LOCAL_STORE_PAGINATION;
        if (!paginationApi) {
            pendingLocalStorePaginationAnimation = animationState || pendingLocalStorePaginationAnimation;
            if (localStorePaginationReadyListener) return;
            localStorePaginationReadyListener = () => {
                const pendingAnimation = pendingLocalStorePaginationAnimation;
                localStorePaginationReadyListener = null;
                pendingLocalStorePaginationAnimation = null;
                initLocalStorePaginationPhysics({animationState: pendingAnimation});
            };
            window.addEventListener(
                "worthward:local-store-pagination-ready",
                localStorePaginationReadyListener,
                {once: true},
            );
            return;
        }

        const active = pagination.querySelector(".local-store-page-button.is-active");
        const currentPage = Number.parseInt(
            pagination.dataset.paginationCurrentPage
            || active?.getAttribute("data-pagination-target")
            || active?.textContent?.trim()
            || "1",
            10,
        ) || 1;
        const totalPages = Number.parseInt(pagination.dataset.paginationPageCount || "1", 10) || 1;
        const paginationState = paginationApi.buildLocalStorePagination(totalPages, currentPage);
        const canonicalUrl = buildSettingsUrl(window.location.href, {
            section: "local-market-store",
            page: paginationState.currentPage,
        });
        const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (currentUrl !== canonicalUrl) {
            window.history.replaceState({localStore: true}, "", canonicalUrl);
            rememberCurrentViewUrl(canonicalUrl);
        }
        paginationApi.renderLocalStorePagination(pagination, paginationState, {
            hrefForPage: buildLocalStorePageHref,
        });
        pagination.dataset.paginationCurrentPage = String(paginationState.currentPage);
        if (animationState) {
            paginationApi.animateLocalStorePaginationIndicator(pagination, animationState);
        }
    };

    const fetchLocalStorePage = async (url, {
        pushHistory = true,
        animationState = null,
        requestGeneration = localStorePaginationRequestGeneration,
    } = {}) => {
        const response = await fetch(url, {
            headers: {
                "X-Requested-With": "fetch",
            },
            credentials: "same-origin",
            cache: "no-store",
        });
        if (!response.ok) throw new Error(`Local store page fetch failed: ${response.status}`);
        if (requestGeneration !== localStorePaginationRequestGeneration) return false;
        const html = await response.text();
        if (requestGeneration !== localStorePaginationRequestGeneration) return false;
        const parser = new DOMParser();
        const nextDocument = parser.parseFromString(html, "text/html");
        const nextShell = nextDocument.querySelector("#settings_workspace_shell");
        if (!nextShell) throw new Error("Settings workspace shell missing from response.");
        const requestedUrl = new URL(url, window.location.origin);
        const nextPagination = nextShell.querySelector("[data-local-store-pagination]");
        const nextPageInput = nextShell.querySelector('.local-store-maintain-card input[name="page"]');
        const actualPage = nextPagination?.getAttribute("data-pagination-current-page")
            || nextPageInput?.value
            || requestedUrl.searchParams.get("page")
            || "1";
        const actualUrl = buildSettingsUrl(requestedUrl, {
            section: "local-market-store",
            page: actualPage,
        });
        if (requestGeneration !== localStorePaginationRequestGeneration) return false;
        replaceLocalStoreRegion(nextShell);
        if (pushHistory) window.history.pushState({localStore: true}, "", actualUrl);
        else if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== actualUrl) {
            window.history.replaceState({localStore: true}, "", actualUrl);
        }
        rememberCurrentViewUrl(actualUrl);
        void hydrateLocalStoreRanges();
        initLocalStorePaginationPhysics({animationState});
        return true;
    };

    const captureLocalStorePaginationTransition = (link, targetUrl) => {
        const paginationApi = window.WORTHWARD_LOCAL_STORE_PAGINATION;
        const pagination = link.closest("[data-local-store-pagination]");
        if (!paginationApi || !(pagination instanceof HTMLElement)) return null;

        const targetPage = new URL(targetUrl, window.location.origin).searchParams.get("page") || "1";
        return paginationApi.captureLocalStorePaginationAnimation(pagination, targetPage);
    };

    const attachLocalStorePagination = () => {
        initLocalStorePaginationPhysics();
        if (didBindLocalStorePagination) return;
        didBindLocalStorePagination = true;
        document.addEventListener("click", (event) => {
            const link = event.target.closest(".local-store-pagination a");
            if (!(link instanceof HTMLAnchorElement)) return;
            if (!window.location.pathname.startsWith("/settings/local-market-store")) return;
            if (
                event.defaultPrevented
                || event.button !== 0
                || event.metaKey
                || event.ctrlKey
                || event.shiftKey
                || event.altKey
            ) return;
            if (link.getAttribute("aria-current") === "page") return;
            const targetUrl = link.href;
            if (!targetUrl) return;
            event.preventDefault();
            if (localStorePaginationRequest) return;
            const requestGeneration = ++localStorePaginationRequestGeneration;
            localStorePaginationRequest = (async () => {
                try {
                    const targetPage = new URL(targetUrl, window.location.origin).searchParams.get("page") || "1";
                    const animationState = captureLocalStorePaginationTransition(link, targetUrl);
                    const pendingRegion = buildLocalStorePendingRegion(targetPage);
                    const currentRegion = document.getElementById("local_store_region");
                    if (currentRegion && pendingRegion) {
                        const currentTableWrap = currentRegion.querySelector(".local-store-table-wrap");
                        const nextTableWrap = pendingRegion.querySelector(".local-store-table-wrap");
                        if (currentTableWrap && nextTableWrap) {
                            currentTableWrap.replaceWith(nextTableWrap);
                        }
                    }
                    await fetchLocalStorePage(targetUrl, {animationState, requestGeneration});
                } catch (_error) {
                    if (requestGeneration === localStorePaginationRequestGeneration) {
                        window.location.assign(targetUrl);
                    }
                } finally {
                    if (requestGeneration === localStorePaginationRequestGeneration) {
                        localStorePaginationRequest = null;
                    }
                }
            })();
        });

        window.addEventListener("popstate", () => {
            if (!window.location.pathname.startsWith("/settings/local-market-store")) return;
            if (!(document.querySelector("[data-local-store-region]") instanceof HTMLElement)) return;
            const requestGeneration = ++localStorePaginationRequestGeneration;
            localStorePaginationRequest = null;
            fetchLocalStorePage(window.location.pathname + window.location.search, {
                pushHistory: false,
                requestGeneration,
            }).catch(() => {
                if (requestGeneration === localStorePaginationRequestGeneration) {
                    window.location.assign(
                        window.location.pathname + window.location.search + window.location.hash,
                    );
                }
            });
        });
    };

    const attachColorTokenControls = () => {
        const root = document.querySelector("[data-color-token-layout]");
        const colorTokens = window.WORTHWARD_COLOR_TOKENS;
        if (!(root instanceof HTMLElement) || !colorTokens) return;

        const controls = () => [...root.querySelectorAll("[data-color-token-control]")];
        const syncControl = (control) => {
            if (!(control instanceof HTMLElement)) return;
            const tokenName = control.dataset.colorTokenName || "";
            const mode = control.dataset.colorTokenMode || "light";
            const defaultValue = control.dataset.colorTokenDefault || "";
            const value = colorTokens.getOverride(tokenName, mode) || defaultValue;
            const valueInput = control.querySelector("[data-color-token-value]");
            const picker = control.querySelector("[data-color-token-picker]");
            const swatch = control.querySelector("[data-color-token-swatch]");
            if (valueInput instanceof HTMLInputElement) {
                valueInput.value = value;
                valueInput.classList.remove("is-invalid");
            }
            if (picker instanceof HTMLInputElement && /^#[0-9a-f]{6}$/i.test(value)) picker.value = value;
            if (swatch instanceof HTMLElement) swatch.style.setProperty("--color-token-swatch-value", value);
        };
        const syncToken = (tokenName, mode) => {
            controls().forEach((control) => {
                if (control.dataset.colorTokenName === tokenName && (!mode || control.dataset.colorTokenMode === mode)) {
                    syncControl(control);
                }
            });
        };
        const saveValue = (control, value) => {
            const tokenName = control.dataset.colorTokenName || "";
            const mode = control.dataset.colorTokenMode || "light";
            const valueInput = control.querySelector("[data-color-token-value]");
            if (!colorTokens.isValidColor(value)) {
                valueInput?.classList.add("is-invalid");
                return;
            }
            if (colorTokens.setOverride(tokenName, mode, value)) syncToken(tokenName, mode);
        };

        controls().forEach((control) => {
            if (!(control instanceof HTMLElement)) return;
            syncControl(control);
            if (control.dataset.colorTokenBound === "1") return;
            control.dataset.colorTokenBound = "1";
            const valueInput = control.querySelector("[data-color-token-value]");
            const picker = control.querySelector("[data-color-token-picker]");
            valueInput?.addEventListener("input", () => saveValue(control, valueInput.value));
            valueInput?.addEventListener("change", () => saveValue(control, valueInput.value));
            picker?.addEventListener("input", () => saveValue(control, picker.value));
            picker?.addEventListener("change", () => saveValue(control, picker.value));
            control.querySelector("[data-color-token-reset]")?.addEventListener("click", () => {
                colorTokens.resetOverride(control.dataset.colorTokenName || "", control.dataset.colorTokenMode || "light");
                syncToken(control.dataset.colorTokenName || "", control.dataset.colorTokenMode || "light");
            });
        });

        root.querySelectorAll("[data-color-token-group-link]").forEach((link) => {
            if (!(link instanceof HTMLAnchorElement) || link.dataset.colorTokenLinkBound === "1") return;
            link.dataset.colorTokenLinkBound = "1";
            link.addEventListener("click", () => {
                root.querySelectorAll("[data-color-token-group-link]").forEach((candidate) => candidate.classList.remove("is-active"));
                link.classList.add("is-active");
            });
        });

        const resetAll = root.querySelector("[data-color-token-reset-all]");
        if (resetAll instanceof HTMLButtonElement && resetAll.dataset.colorTokenResetBound !== "1") {
            resetAll.dataset.colorTokenResetBound = "1";
            resetAll.addEventListener("click", () => {
                colorTokens.resetAll();
                controls().forEach(syncControl);
            });
        }

        if (!didBindColorTokenGlobalEvents) {
            didBindColorTokenGlobalEvents = true;
            window.addEventListener("worthward:color-token-change", () => {
                document.querySelectorAll("[data-color-token-layout] [data-color-token-control]").forEach((control) => {
                    if (control instanceof HTMLElement) syncControl(control);
                });
            });
        }
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
            supersedeLocalStorePaginationRequest();
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
                window.history.pushState({settingsSection: targetSection}, "", nextUrl);
                state.settingsSection = targetSection;
                rememberCurrentViewUrl(nextUrl);
                reinitializeSettingsWorkspaceRegion();
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
            const hasLocalStoreRegion = document.querySelector("[data-local-store-region]") instanceof HTMLElement;
            if (section === "local-market-store" && hasLocalStoreRegion) return;
            supersedeLocalStorePaginationRequest();
            setActiveSettingsNav(section);
            state.settingsSection = section;
            renderOptimisticNavigationSkeleton({view: "settings", section});
            try {
                const responseText = await fetch(window.location.pathname + window.location.search, {
                    credentials: "same-origin",
                    headers: {"X-Requested-With": "settings-popstate"},
                    cache: section === "local-market-store" ? "no-store" : "force-cache",
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
        const languageUi = {
            saving: form.dataset.languageSavingLabel || translateUi("Saving..."),
            savingTranslations: form.dataset.languageSavingTranslationsLabel || translateUi("Saving translations..."),
            saved: form.dataset.languageSavedLabel || translateUi("Translations saved."),
            saveError: form.dataset.languageSaveErrorLabel || translateUi("Unable to save translations right now."),
        };
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
                    saveButton.dataset.languageSaveLabel = saveButton.dataset.languageSaveLabel || saveButton.textContent || translateUi("Save translations");
                    saveButton.textContent = languageUi.saving;
                } else {
                    saveButton.textContent = saveButton.dataset.languageSaveLabel || translateUi("Save translations");
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
                setSaveFeedback(languageUi.savingTranslations, "");
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
                    setSaveFeedback(languageUi.saved, "success");
                } catch (_error) {
                    setSaveFeedback(languageUi.saveError, "error");
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
            const nextTab = targetName === "history" ? "history" : "current";
            tabs.forEach((tab, index) => {
                const isActive = tab.dataset.languageTab === nextTab;
                tab.setAttribute("aria-selected", String(isActive));
                tab.tabIndex = isActive ? 0 : -1;
                if (isActive && tabShell instanceof HTMLElement) {
                    tabShell.dataset.active = nextTab;
                    tabShell.dataset.segmentedActiveIndex = String(index);
                    tabShell.style.setProperty("--segmented-active-index", String(index));
                }
            });
            panels.forEach((panel) => {
                const isActive = panel.dataset.languagePanel === nextTab;
                panel.classList.toggle("is-active", isActive);
                panel.hidden = !isActive;
            });
            return nextTab;
        };
        tabs.forEach((tab) => {
            tab.addEventListener("click", () => {
                const nextTab = tab.dataset.languageTab === "history" ? "history" : "current";
                const currentState = parseSettingsUrlState(window.location.href);
                if (currentState.tab !== nextTab || currentState.page !== 1) {
                    syncSettingsUrl({
                        section: "general",
                        tab: nextTab,
                        page: 1,
                        historyMode: "push",
                    });
                }
                setActiveTab(nextTab);
                const targetPanel = panels.find((panel) => panel.dataset.languagePanel === nextTab);
                const targetPagination = targetPanel?.querySelector("[data-language-pagination]");
                const targetBody = targetPanel?.querySelector("[data-language-paginated-body]");
                if (targetPagination instanceof HTMLElement && targetBody instanceof HTMLElement) {
                    renderPagination(targetPagination, targetBody, 1);
                }
            });
        });

        const initialSettingsState = canonicalizeSettingsUrl();
        setActiveTab(initialSettingsState.tab);

        const renderPagination = (pagination, body, page) => {
            if (!(pagination instanceof HTMLElement) || !(body instanceof HTMLElement)) return;
            const paginationApi = window.WORTHWARD_LOCAL_STORE_PAGINATION;
            if (!paginationApi) {
                window.addEventListener('worthward:local-store-pagination-ready', () => {
                    renderPagination(pagination, body, page);
                }, {once: true});
                return;
            }
            const rows = Array.from(body.querySelectorAll("[data-language-row]"))
                .filter((row) => row instanceof HTMLTableRowElement);
            const pageSize = Math.max(Number.parseInt(body.dataset.languagePageSize || "10", 10) || 10, 1);
            const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
            const requestedPage = Number.parseInt(String(page || "1"), 10) || 1;
            const currentPage = Math.min(Math.max(requestedPage, 1), totalPages);
            rows.forEach((row, index) => {
                const rowPage = Math.floor(index / pageSize) + 1;
                row.hidden = rowPage !== currentPage;
            });
            if (pagination.closest('[data-language-panel]')?.classList.contains("is-active")) {
                const currentUrlState = parseSettingsUrlState(window.location.href);
                if (currentUrlState.page !== currentPage) {
                    syncSettingsUrl({
                        section: "general",
                        tab: pagination.dataset.languagePagination || "current",
                        page: currentPage,
                        historyMode: "replace",
                    });
                }
            }
            const paginationState = paginationApi.buildLocalStorePagination(totalPages, currentPage);
            paginationApi.renderLocalStorePagination(pagination, paginationState, {
                additionalPageTargetAttribute: "data-language-page",
            });
            paginationApi.bindLocalStorePagination(
                pagination,
                (nextPage, {animationState}) => {
                    renderPagination(pagination, body, nextPage);
                    if (pagination.closest('[data-language-panel]')?.classList.contains("is-active")) {
                        syncSettingsUrl({
                            section: "general",
                            tab: pagination.dataset.languagePagination || "current",
                            page: nextPage,
                            historyMode: "replace",
                        });
                    }
                    paginationApi.animateLocalStorePaginationIndicator(pagination, animationState);
                },
            );
        };

        form.querySelectorAll("[data-language-pagination]").forEach((pagination) => {
            if (!(pagination instanceof HTMLElement)) return;
            const panelName = pagination.dataset.languagePagination || "current";
            const panel = form.querySelector(`[data-language-panel="${panelName}"]`);
            const body = panel?.querySelector("[data-language-paginated-body]");
            const initialPage = panel instanceof HTMLElement
                ? Number.parseInt(panel.dataset.languageInitialPage || "1", 10) || 1
                : 1;
            if (body instanceof HTMLElement) renderPagination(pagination, body, initialPage);
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
        attachLongbridgeOauthMonitor();
        attachNetworkRefreshButton();
        attachSettingsSummaryMorph();
        attachStyleTokenResizer();
        attachStyleTokenDemoResponsiveness();
        attachStyleTokenControls();
        attachColorTokenControls();
        attachTextInputClearHandlers();
        attachStyleTokenReferences();
        attachStyleTokenCopyButtons();
        attachStyleTokenModeSwitches();
        attachStyleTokenTableFilterDemos();
        attachStyleTokenPaginationDemos();
        attachStyleTokenDemoInteractions();
        attachStyleTokenActionPackageLiveControl();
        revealStyleTokenHashTarget();
        attachLocalStoreMaintainAction();
        attachLocalStorePagination();
        attachSettingsSectionNavigation();
        attachLanguageMappingHandlers();
        attachCashEquivalentsHandlers();
        // Module scripts execute after the classic app bootstrap. Hydrate here as well
        // so progressive Settings placeholders cannot remain in the Checking... state.
        void hydrateNetworkStatuses();
        void hydrateLocalStoreRanges();
    };

    window.dispatchEvent(new Event("worthward:settings-bootstrap-ready"));

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
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-CSRF-Token': window.WORTHWARD_APP?.security?.investmentCsrfToken || '',
                },
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
                    <label style="font-size: var(--font-form-label);">${translateUi("Add ticker")}</label>
                    <div class="ticker-input-control">
                        <span class="ticker-leading-slot" aria-hidden="true">
                            <span class="ticker-logo-placeholder"></span>
                            <img class="ticker-input-logo" alt="" hidden>
                        </span>
                        <input class="text-input-control" data-ticker-input placeholder="e.g. BOXX" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="latin">
                        <button type="button" class="ticker-clear" aria-label="${translateUi("Clear")}"><span class="icon icon-remove-muted" aria-hidden="true"></span></button>
                    </div>
                </div>
                <button type="button" class="ticker-remove cash-equiv-cancel-add" aria-label="${translateUi("Cancel add")}"><span class="icon icon-remove-muted" aria-hidden="true"></span></button>
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
