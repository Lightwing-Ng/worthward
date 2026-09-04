/* Code version: v0.8.0 */
(() => {
    const state = window.WORTHWARD_APP || {};
    const POLL_INTERVAL_MS = 5000;
    let activeMenu = null;
    let pollTimer = null;
    let cachedRuns = [];
    let lastFetchedAt = 0;
    let fetchInFlight = null;
    let pendingAction = "";
    let actionError = "";
    let historyError = "";
    let protocolVersion = 0;
    const selectionKey = "worthward.lstm.selected-configuration.v1";
    let selection = null;
    try { selection = JSON.parse(window.sessionStorage.getItem(selectionKey) || "null"); } catch { /* Storage is optional. */ }
    if (!selection || typeof selection.id !== "string" || !selection.configuration
        || typeof selection.configuration !== "object" || !selection.configuration.params) selection = null;
    let expandedRunId = selection?.id || "";
    const stoppingRunIds = new Set();
    const historySnapshots = new WeakMap();

    const isLstmStrategySelected = () => (
        String(document.getElementById("trade_strategy")?.value || "") === "lstm-price-field"
    );

    const endpoint = (name, fallback) => String(state.endpoints?.[name] || fallback);

    const privateMenuHost = () => document.querySelector(
        '#trade_strategy_params_panel [data-strategy-action-slot="lstm-training"]',
    );
    const currentTicker = () => String(
        document.querySelector("[data-ticker-input]")?.value || "",
    ).trim().toUpperCase();

    const currentPeriod = () => String(document.getElementById("period")?.value || "1y").trim().toLowerCase();

    const currentInterval = () => String(document.querySelector('[name="interval"]:checked')?.value
        || document.querySelector('[name="interval"]')?.value || "").trim().toLowerCase();

    // UTC start dates keep identifiers stable across browser time zones.
    const historyIdentifiers = (runs) => {
        const counters = new Map();
        const identifiers = new Map();
        [...runs].sort((left, right) => (Date.parse(left.started_at) || 0) - (Date.parse(right.started_at) || 0)
            || String(left.id).localeCompare(String(right.id))).forEach((run) => {
            const date = new Date(String(run.started_at || ""));
            if (Number.isNaN(date.getTime())) return;
            const day = date.toISOString().slice(2, 10).replaceAll("-", "");
            const key = `${run.ticker}:${day}`;
            const sequence = (counters.get(key) || 0) + 1;
            counters.set(key, sequence);
            identifiers.set(run.id, `${day}(${String(sequence).padStart(2, "0")})`);
        });
        return identifiers;
    };

    const currentParameters = () => Object.fromEntries(Array.from(
        document.querySelectorAll("#trade_strategy_params_panel [data-strategy-param-input][name]"),
        (input) => [input.name, input.type === "checkbox" ? input.checked : input.value],
    ));

    const currentConfiguration = () => {
        const value = (name) => document.querySelector(`[data-backtest-parameter-form] [name="${name}"]:checked`)?.value
            || document.querySelector(`[data-backtest-parameter-form] [name="${name}"]`)?.value || "";
        const checked = (name) => Boolean(document.querySelector(`[data-backtest-parameter-form] input[type="checkbox"][name="${name}"]`)?.checked);
        return {
            range: value("range"), from: value("from"), to: value("to"),
            initial_capital: Number(value("capital").replaceAll(",", "")),
            price_only: checked("price_only"), reinvest_dividends: checked("dividends"),
            stop_loss: checked("stop_loss"), show_trade_details: checked("show_trade_details"),
        };
    };

    const saveSelection = (value) => {
        selection = value;
        try {
            if (value) window.sessionStorage.setItem(selectionKey, JSON.stringify(value));
            else window.sessionStorage.removeItem(selectionKey);
        } catch { /* Selection still works for this page when storage is unavailable. */ }
    };

    const configurationMatches = (config) => {
        const current = {...currentConfiguration(), ticker: currentTicker(), period: currentPeriod(), interval: currentInterval()};
        const params = currentParameters();
        const same = (left, right) => typeof right === "number" ? Number(left) === right
            : typeof right === "boolean" ? [true, "true", "1", 1].includes(left) === right : left === right;
        return isLstmStrategySelected() && Object.entries(config).every(([key, value]) => {
            if (key === "strategy") return value === "lstm-price-field";
            if (key === "params") return Object.entries(value).every(([name, saved]) => same(params[name], saved));
            return same(current[key], value);
        });
    };

    const configurationUrl = (config, source = window.location.href) => {
        const url = new URL(source, window.location.href);
        url.search = "";
        const aliases = {initial_capital: "capital", reinvest_dividends: "dividends"};
        Object.entries({...config, ...config.params}).forEach(([key, value]) => {
            if (key !== "params") url.searchParams.set(aliases[key] || key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
        });
        return url;
    };

    const preserveSelectionUrl = (source) => {
        if (!selection || !configurationMatches(selection.configuration)) return source;
        const url = configurationUrl(selection.configuration, source);
        return `${url.pathname}${url.search}${url.hash}`;
    };

    const applyConfiguration = (run) => {
        const config = run.configuration;
        if (!config || run.status !== "completed") return false;
        saveSelection({id: run.id, configuration: config});
        if (configurationMatches(config)) {
            window.history.replaceState(window.history.state, "", configurationUrl(config));
            return false;
        }
        window.location.assign(configurationUrl(config).href);
        return true;
    };

    // Any explicit form edit detaches the saved case, even if the user later changes it back.
    const detachSelection = (event) => {
        if (!selection || !event.target.closest("[data-backtest-parameter-form]")
            || !event.target.matches("input, select, textarea")) return;
        if (!event.isTrusted && configurationMatches(selection.configuration)) return;
        saveSelection(null);
        if (activeMenu) updateMenu(activeMenu);
    };
    document.addEventListener("input", detachSelection, true);
    document.addEventListener("change", detachSelection, true);

    const formatDate = (rawValue) => {
        const date = new Date(String(rawValue || ""));
        if (Number.isNaN(date.getTime())) return "Date unavailable";
        const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        }).formatToParts(date).map((part) => [part.type, part.value]));
        return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute}`;
    };

    const formatNumber = (value, digits = 0) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return "";
        return numeric.toLocaleString("en-US", {
            maximumFractionDigits: digits,
            minimumFractionDigits: digits,
        });
    };

    const statusLabel = (status) => ({
        starting: "Starting",
        running: "Running",
        stopping: "Stopping",
        completed: "Completed",
        interrupted: "Interrupted",
        time_budget_reached: "Time budget reached",
        failed_closed: "Failed closed",
        stale: "Stale",
        unknown: "Unavailable",
    }[String(status || "unknown")] || "Unavailable");

    const appendText = (parent, className, value) => {
        const element = document.createElement("span");
        element.className = className;
        element.textContent = value;
        parent.appendChild(element);
        return element;
    };

    const buildActionButton = (action, label, iconClass) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary-button lstm-training-action";
        button.dataset.lstmTrainingAction = action;
        button.title = label;
        button.setAttribute("aria-label", label);
        const icon = document.createElement("span");
        icon.className = `icon lstm-training-action-icon ${iconClass}`;
        icon.setAttribute("aria-hidden", "true");
        button.appendChild(icon);
        appendText(button, "lstm-training-action-label", label);
        return button;
    };

    const buildProgress = (run) => {
        const container = document.createElement("div");
        container.className = "lstm-training-progress";
        const value = run.progress?.percent;
        const known = typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
        appendText(container, "lstm-training-progress-label", known
            ? `${statusLabel(run.status)} · ${formatNumber(value, 1)}%`
            : `${statusLabel(run.status)} · Progress unavailable`);
        const track = document.createElement("div");
        track.className = "lstm-training-progress-track";
        track.setAttribute("role", "progressbar");
        track.setAttribute("aria-label", `LSTM training progress for ${run.ticker}`);
        track.setAttribute("aria-valuemin", "0");
        track.setAttribute("aria-valuemax", "100");
        if (known) track.setAttribute("aria-valuenow", String(value));
        else track.setAttribute("aria-valuetext", "Progress unavailable");
        const fill = document.createElement("span");
        fill.className = "lstm-training-progress-fill";
        if (known) fill.style.width = `${value}%`;
        else track.classList.add(run.active ? "is-indeterminate" : "is-unavailable");
        track.appendChild(fill);
        container.appendChild(track);
        return container;
    };

    const buildHistoryItem = (run, identifier) => {
        const item = document.createElement("div");
        item.className = "lstm-training-history-item";
        item.dataset.lstmTrainingRunId = String(run.id || "");
        const summary = document.createElement("button");
        summary.type = "button";
        summary.className = "lstm-training-history-select";
        summary.setAttribute("aria-expanded", String(expandedRunId === run.id));
        summary.setAttribute("aria-pressed", String(selection?.id === run.id));
        summary.setAttribute("aria-controls", `lstm-run-details-${run.id}`);
        const check = appendText(summary, "lstm-training-selected-icon", "");
        check.setAttribute("aria-hidden", "true");
        appendText(summary, "lstm-training-history-run", run.ticker || "Unknown ticker");
        if (typeof run.accuracy_pct === "number" && Number.isFinite(run.accuracy_pct)) {
            const badge = appendText(summary, "investment-holdings-allocation-badge lstm-training-accuracy", `${formatNumber(run.accuracy_pct, 2)}%`);
            badge.title = run.accuracy_label || "Holdout direction accuracy";
            badge.setAttribute("aria-label", `${badge.title}: ${badge.textContent}`);
        }
        appendText(summary, "lstm-training-history-identifier", identifier || "Date unavailable");
        summary.addEventListener("click", () => {
            const selecting = run.configuration && run.status === "completed" && selection?.id !== run.id;
            expandedRunId = selecting || expandedRunId !== run.id ? run.id : "";
            if (selecting && applyConfiguration(run)) return;
            updateMenu(activeMenu);
        });
        item.appendChild(summary);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "ticker-remove lstm-training-delete";
        remove.dataset.lstmTrainingDelete = String(run.id);
        remove.title = `Delete ${run.ticker} ${identifier || "undated run"} (recoverable)`;
        remove.setAttribute("aria-label", `Delete ${run.ticker} ${identifier || "undated run"}`);
        remove.disabled = Boolean(run.active || pendingAction || protocolVersion < 2);
        appendText(remove, "icon icon-remove-muted", "").setAttribute("aria-hidden", "true");
        remove.addEventListener("click", () => postTrainingAction(activeMenu, "delete", run.id));
        item.appendChild(remove);

        const details = document.createElement("div");
        details.className = "lstm-training-history-details";
        details.id = `lstm-run-details-${run.id}`;
        details.hidden = expandedRunId !== run.id;
        appendText(details, "lstm-training-history-meta", `${run.period || "Period unavailable"} · ${run.interval || "Interval not recorded"}`);
        if (run.status !== "completed") appendText(details, "lstm-training-status", statusLabel(run.status));
        appendText(details, "lstm-training-history-meta", `Started ${formatDate(run.started_at)}`);
        if (run.completed_at) appendText(details, "lstm-training-history-meta", `Completed ${formatDate(run.completed_at)}`);
        if (run.configuration) appendText(details, "lstm-training-history-meta", `${run.configuration.from} – ${run.configuration.to} · ${run.configuration.interval}`);
        if (run.requested_range?.from && run.requested_range?.to) appendText(details, "lstm-training-history-meta", `Requested window ${run.requested_range.from} – ${run.requested_range.to}`);
        if (run.configuration_error) appendText(details, "lstm-training-history-meta", run.configuration_error);
        if (run.device) appendText(details, "lstm-training-history-meta", `Backend ${run.device.resolved} · ${formatNumber(run.device.optimizer_steps)} optimizer steps · ${formatNumber(run.device.training_compute_seconds, 2)} s compute`);
        const progress = [];
        if (run.generation != null && Number.isFinite(Number(run.generation))) progress.push(`Generation ${formatNumber(run.generation)}`);
        if (run.evaluated != null && Number.isFinite(Number(run.evaluated))) progress.push(`${formatNumber(run.evaluated)} evaluations`);
        if (progress.length) appendText(details, "lstm-training-history-meta", progress.join(" · "));
        const best = run.best || {};
        if (run.selected_params && typeof run.selected_params === "object") {
            appendText(details, "lstm-training-history-meta", `Selected parameters: ${Object.entries(run.selected_params)
                .map(([key, value]) => `${key}=${value}`).join(" · ")}`);
        }
        if (best.holdout_median_hit_rate_pct != null && Number.isFinite(Number(best.holdout_median_hit_rate_pct))) {
            appendText(details, "lstm-training-history-meta", `Holdout median hit rate ${formatNumber(best.holdout_median_hit_rate_pct, 2)}%`);
        }
        if (best.params && typeof best.params === "object") {
            const parameterText = Object.entries(best.params)
                .map(([key, value]) => `${key}=${value}`)
                .join(" · ");
            if (parameterText) appendText(details, "lstm-training-history-meta", `Best parameters ${parameterText}`);
        }
        const files = document.createElement("ul");
        files.className = "lstm-training-files";
        files.setAttribute("aria-label", "Training files");
        (Array.isArray(run.files) ? run.files : []).forEach((file) => {
            const row = document.createElement("li");
            appendText(row, "lstm-training-file-name", String(file.name || ""));
            appendText(row, "lstm-training-file-size", `${formatNumber(file.size_bytes)} B`);
            files.appendChild(row);
        });
        if (files.childElementCount) details.appendChild(files);
        if (run.error) appendText(details, "lstm-training-history-error", run.error);
        item.appendChild(details);
        return item;
    };

    const updateMenu = (menu) => {
        if (!(menu instanceof HTMLElement)) return;
        const ticker = currentTicker();
        const activeRun = cachedRuns.find((run) => run.active && run.ticker === ticker) || cachedRuns.find((run) => run.active) || null;
        if (selection && !configurationMatches(selection.configuration)) saveSelection(null);
        const heading = menu.closest('[data-collapse="training"]')?.querySelector(":scope > summary");
        if (heading) {
            let spinner = heading.querySelector(".lstm-training-spinner");
            if (!spinner) {
                spinner = appendText(heading, "suggestion-loading-spinner lstm-training-spinner", "");
                spinner.setAttribute("role", "status");
                spinner.setAttribute("aria-label", "Training in progress");
            }
            spinner.hidden = !activeRun && pendingAction !== "start";
        }
        const liveProgress = menu.querySelector("[data-lstm-training-progress]");
        if (liveProgress) liveProgress.replaceChildren(...(activeRun ? [buildProgress(activeRun)] : []));
        const button = menu.querySelector("[data-lstm-training-action]");
        if (button instanceof HTMLButtonElement) {
            const action = activeRun ? "stop" : "start";
            const stopping = activeRun && (activeRun.status === "stopping" || stoppingRunIds.has(activeRun.id));
            const label = pendingAction === "start" ? "Starting training…"
                : pendingAction === "stop" || stopping ? "Stopping training…"
                    : activeRun ? "Stop training" : "Start training";
            button.dataset.lstmTrainingAction = action;
            button.disabled = Boolean(pendingAction || stopping || (!activeRun && (!lastFetchedAt || historyError || protocolVersion < 2)));
            button.title = label;
            button.setAttribute("aria-label", label);
            button.setAttribute("aria-busy", String(Boolean(pendingAction)));
            button.querySelector(".lstm-training-action-label").textContent = label;
            button.querySelector(".lstm-training-action-icon").className = `icon lstm-training-action-icon lstm-training-${action}-icon`;
        }

        const status = menu.querySelector("[data-lstm-training-status]");
        if (status instanceof HTMLElement) {
            status.textContent = actionError || historyError || (lastFetchedAt && protocolVersion < 2 ? "Restart the local service to enable updated training controls." : "");
            status.hidden = !status.textContent;
        }

        const count = menu.querySelector("[data-lstm-training-count]");
        const historyRuns = cachedRuns.filter((run) => !run.active);
        if (count instanceof HTMLElement) count.textContent = formatNumber(historyRuns.length);
        const historyItems = menu.querySelector("[data-lstm-training-history-items]");
        if (!(historyItems instanceof HTMLElement)) return;
        const snapshot = JSON.stringify([historyRuns, expandedRunId, selection?.id, pendingAction, protocolVersion]);
        if (historySnapshots.get(historyItems) === snapshot) return;
        historySnapshots.set(historyItems, snapshot);
        const focusedRunId = document.activeElement?.closest("[data-lstm-training-run-id]")?.dataset.lstmTrainingRunId;
        historyItems.replaceChildren();
        if (!historyRuns.length) {
            appendText(historyItems, "lstm-training-history-empty", "No historical LSTM training runs.");
            return;
        }
        const identifiers = historyIdentifiers(cachedRuns);
        historyRuns.forEach((run) => {
            const item = buildHistoryItem(run, run.identifier || identifiers.get(run.id));
            const entry = document.createElement("div");
            entry.className = "lstm-training-history-entry";
            entry.appendChild(item);
            if (run.status !== "completed") appendText(entry, "lstm-training-status", statusLabel(run.status));
            historyItems.appendChild(entry);
            if (focusedRunId === String(run.id || "")) item.querySelector(".lstm-training-history-select").focus({preventScroll: true});
        });
    };

    const refreshRuns = async (menu, force = false) => {
        if (!(menu instanceof HTMLElement) || !menu.isConnected || !isLstmStrategySelected()) return;
        if (!force && Date.now() - lastFetchedAt < POLL_INTERVAL_MS) {
            updateMenu(menu);
            return;
        }
        if (fetchInFlight) {
            await fetchInFlight;
            updateMenu(menu);
            return;
        }
        const url = endpoint("lstmTraining", "/api/lstm-training");
        fetchInFlight = fetch(url, {credentials: "same-origin", cache: "no-store"})
            .then(async (response) => {
                const payload = await response.json().catch(() => ({}));
                if (!response.ok || payload.success === false) {
                    throw new Error(payload.error || "LSTM training history is unavailable.");
                }
                cachedRuns = Array.isArray(payload.runs) ? payload.runs : [];
                protocolVersion = Number(payload.protocol_version || 0);
                if (selection && !cachedRuns.some((run) => run.id === selection.id && run.configuration)) saveSelection(null);
                stoppingRunIds.forEach((id) => {
                    if (!cachedRuns.some((run) => run.id === id && run.active)) stoppingRunIds.delete(id);
                });
                lastFetchedAt = Date.now();
                historyError = "";
            })
            .catch((error) => {
                historyError = error.message || "LSTM training history is unavailable.";
            })
            .finally(() => {
                fetchInFlight = null;
            });
        await fetchInFlight;
        updateMenu(menu);
    };

    const postTrainingAction = async (menu, action, runId = "") => {
        if (pendingAction) return;
        if (action === "start" && currentInterval() !== "1d") {
            actionError = "LSTM training currently requires Interval 1d. Select 1d to train; 1m is not supported.";
            updateMenu(menu);
            return;
        }
        pendingAction = action;
        actionError = "";
        updateMenu(menu);
        const csrfToken = String(state.security?.investmentCsrfToken || "");
        const payload = action === "start"
            ? {ticker: currentTicker(), period: currentPeriod(), interval: currentInterval(), params: currentParameters(), configuration: currentConfiguration()}
            : {run_id: runId};
        const url = endpoint(
            {start: "lstmTrainingStart", stop: "lstmTrainingStop", delete: "lstmTrainingDelete"}[action],
            `/api/lstm-training/${action}`,
        );
        try {
            const response = await fetch(url, {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRF-Token": csrfToken,
                },
                body: JSON.stringify(payload),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || result.success === false) {
                throw new Error(result.error || "The LSTM training action failed.");
            }
            if (result.run?.id) cachedRuns = [result.run, ...cachedRuns.filter((run) => run.id !== result.run.id)];
            if (action === "stop" && result.run?.active) stoppingRunIds.add(runId);
            if (action === "delete") {
                cachedRuns = cachedRuns.filter((run) => run.id !== runId);
                if (selection?.id === runId) saveSelection(null);
                if (expandedRunId === runId) expandedRunId = "";
            }
            if (fetchInFlight) await fetchInFlight;
            lastFetchedAt = 0;
            await refreshRuns(menu, true);
        } catch (error) {
            actionError = error.message || "The LSTM training action failed.";
        } finally {
            pendingAction = "";
            updateMenu(menu);
        }
    };

    const stopPolling = () => {
        if (pollTimer !== null) window.clearInterval(pollTimer);
        pollTimer = null;
        activeMenu = null;
    };

    const startPolling = (menu) => {
        if (activeMenu === menu && pollTimer !== null) return;
        stopPolling();
        activeMenu = menu;
        pollTimer = window.setInterval(() => {
            if (!menu.isConnected || !isLstmStrategySelected()) {
                stopPolling();
                return;
            }
            refreshRuns(menu, true);
        }, POLL_INTERVAL_MS);
    };

    const renderMenu = () => {
        const host = privateMenuHost();
        if (!(host instanceof HTMLElement)) {
            stopPolling();
            return;
        }
        if (!isLstmStrategySelected()) {
            stopPolling();
            host.replaceChildren();
            host.hidden = true;
            return;
        }
        host.hidden = false;
        let menu = host.querySelector("[data-lstm-training-menu]");
        if (menu instanceof HTMLElement) {
            updateMenu(menu);
            startPolling(menu);
            refreshRuns(menu);
            return;
        }
        menu = document.createElement("section");
        menu.className = "lstm-training-menu";
        menu.dataset.lstmTrainingMenu = "true";
        const actions = document.createElement("div");
        actions.className = "lstm-training-actions";
        const actionButton = buildActionButton("start", "Start training", "lstm-training-start-icon");
        actionButton.addEventListener("click", (event) => {
            event.stopPropagation();
            const activeRun = cachedRuns.find((run) => run.active && run.ticker === currentTicker()) || cachedRuns.find((run) => run.active);
            postTrainingAction(menu, activeRun ? "stop" : "start", String(activeRun?.id || ""));
        });
        actions.appendChild(actionButton);
        menu.appendChild(actions);
        const liveProgress = document.createElement("div");
        liveProgress.dataset.lstmTrainingProgress = "true";
        menu.appendChild(liveProgress);
        const liveStatus = appendText(menu, "lstm-training-live-status", "");
        liveStatus.dataset.lstmTrainingStatus = "true";
        liveStatus.setAttribute("role", "status");
        liveStatus.setAttribute("aria-live", "polite");

        const history = document.createElement("section");
        history.className = "lstm-training-history-collapse";
        history.dataset.lstmTrainingHistory = "true";
        const summary = document.createElement("h3");
        summary.className = "lstm-training-history-heading";
        appendText(summary, "lstm-training-history-title", "Training history");
        appendText(summary, "lstm-training-count", "0").dataset.lstmTrainingCount = "true";
        history.appendChild(summary);
        const items = document.createElement("div");
        items.className = "lstm-training-history-items";
        items.dataset.lstmTrainingHistoryItems = "true";
        history.appendChild(items);
        menu.appendChild(history);

        host.replaceChildren(menu);
        updateMenu(menu);
        startPolling(menu);
        refreshRuns(menu);
    };

    window.WORTHWARD_LSTM_TRAINING = {renderMenu, preserveSelectionUrl};
})();
