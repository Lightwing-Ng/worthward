/* Code version: v0.5.0 */
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
    const stoppingRunIds = new Set();
    const historySnapshots = new WeakMap();

    const isLstmStrategySelected = () => (
        String(document.getElementById("trade_strategy")?.value || "") === "lstm-price-field"
    );

    const endpoint = (name, fallback) => String(state.endpoints?.[name] || fallback);

    const privateMenuHost = () => {
        const panel = document.getElementById("trade_strategy_params_panel");
        if (!(panel instanceof HTMLElement)) return null;
        let host = panel.querySelector("[data-lstm-training-private-menu]");
        if (!(host instanceof HTMLElement)) {
            host = document.createElement("div");
            host.className = "lstm-training-private-menu-slot";
            host.dataset.lstmTrainingPrivateMenu = "true";
            host.hidden = true;
            panel.prepend(host);
        }
        if (!isLstmStrategySelected()) {
            panel.querySelectorAll(":scope > [data-lstm-private-section]").forEach((section) => {
                const body = section.querySelector(".lstm-private-collapse-body");
                if (body) section.before(...body.childNodes);
                section.remove();
            });
            return host;
        }
        const wrapSection = (content, key, title, initiallyOpen) => {
            if (!(content instanceof HTMLElement) || content.closest("[data-lstm-private-section]")) return;
            const section = document.createElement("details");
            section.className = "lstm-private-collapse";
            section.dataset.lstmPrivateSection = key;
            section.setAttribute("name", "lstm-private-sections");
            section.open = initiallyOpen;
            const summary = document.createElement("summary");
            summary.textContent = title;
            const body = document.createElement("div");
            body.className = "lstm-private-collapse-body";
            content.before(section);
            body.appendChild(content);
            section.append(summary, body);
        };
        if (!host.closest("[data-lstm-private-section]")) {
            const factors = panel.querySelector("[data-trade-strategy-params-grid]");
            if (factors instanceof HTMLElement) {
                const parameters = factors.cloneNode(false);
                factors.querySelectorAll(":scope > [data-strategy-param-key]").forEach((field) => {
                    if (field.dataset.strategyParamKind !== "boolean") parameters.appendChild(field);
                });
                panel.prepend(parameters);
                wrapSection(parameters, "parameters", "LSTM parameters", false);
            }
            wrapSection(host, "training", "LSTM training", true);
            wrapSection(factors, "factors", "Training factors", false);
        }
        return host;
    };

    const currentTicker = () => String(
        document.querySelector("[data-ticker-input]")?.value || "",
    ).trim().toUpperCase();

    const currentPeriod = () => String(document.getElementById("period")?.value || "1y").trim().toLowerCase();

    const currentParameters = () => Object.fromEntries(Array.from(
        document.querySelectorAll("#trade_strategy_params_panel [data-strategy-param-input][name]"),
        (input) => [input.name, input.type === "checkbox" ? input.checked : input.value],
    ));

    const formatDate = (rawValue) => {
        const date = new Date(String(rawValue || ""));
        if (Number.isNaN(date.getTime())) return "Date unavailable";
        return new Intl.DateTimeFormat("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }).format(date);
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

    const buildHistoryItem = (run) => {
        const item = document.createElement("details");
        item.className = "lstm-training-history-item";
        item.dataset.lstmTrainingRunId = String(run.id || "");
        const summary = document.createElement("summary");
        appendText(summary, "lstm-training-history-run", `${run.ticker || "Unknown ticker"} · ${run.period || "period unavailable"}`);
        appendText(summary, `lstm-training-status is-${String(run.status || "unknown").replaceAll("_", "-")}`, statusLabel(run.status));
        item.appendChild(summary);

        const details = document.createElement("div");
        details.className = "lstm-training-history-details";
        details.appendChild(buildProgress(run));
        appendText(details, "lstm-training-history-meta", `Started ${formatDate(run.started_at)}`);
        if (run.completed_at) appendText(details, "lstm-training-history-meta", `Completed ${formatDate(run.completed_at)}`);
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
        const activeRun = cachedRuns.find((run) => run.active && run.ticker === ticker) || null;
        const button = menu.querySelector("[data-lstm-training-action]");
        if (button instanceof HTMLButtonElement) {
            const action = activeRun ? "stop" : "start";
            const stopping = activeRun && (activeRun.status === "stopping" || stoppingRunIds.has(activeRun.id));
            const label = pendingAction === "start" ? "Starting training…"
                : pendingAction === "stop" || stopping ? "Stopping training…"
                    : activeRun ? "Stop training" : "Start training";
            button.dataset.lstmTrainingAction = action;
            button.disabled = Boolean(pendingAction || stopping || (!activeRun && (!lastFetchedAt || historyError)));
            button.title = label;
            button.setAttribute("aria-label", label);
            button.setAttribute("aria-busy", String(Boolean(pendingAction)));
            button.querySelector(".lstm-training-action-label").textContent = label;
            button.querySelector(".lstm-training-action-icon").className = `icon lstm-training-action-icon lstm-training-${action}-icon`;
        }

        const status = menu.querySelector("[data-lstm-training-status]");
        if (status instanceof HTMLElement) {
            status.textContent = actionError || historyError;
            status.hidden = !status.textContent;
        }

        const count = menu.querySelector("[data-lstm-training-count]");
        if (count instanceof HTMLElement) count.textContent = formatNumber(cachedRuns.length);
        const historyItems = menu.querySelector("[data-lstm-training-history-items]");
        if (!(historyItems instanceof HTMLElement)) return;
        const snapshot = JSON.stringify(cachedRuns);
        if (historySnapshots.get(historyItems) === snapshot) return;
        historySnapshots.set(historyItems, snapshot);
        const focusedRunId = document.activeElement?.closest("[data-lstm-training-run-id]")?.dataset.lstmTrainingRunId;
        const openIds = new Set(
            Array.from(historyItems.querySelectorAll("details[open]"))
                .map((item) => item.dataset.lstmTrainingRunId)
                .filter(Boolean),
        );
        const knownIds = new Set(Array.from(historyItems.querySelectorAll("details"), (item) => item.dataset.lstmTrainingRunId));
        historyItems.replaceChildren();
        if (!cachedRuns.length) {
            appendText(historyItems, "lstm-training-history-empty", "No historical LSTM training runs.");
            return;
        }
        cachedRuns.forEach((run, index) => {
            const item = buildHistoryItem(run);
            if (openIds.has(String(run.id || "")) || (!knownIds.has(String(run.id || "")) && (run.active || index === 0))) item.open = true;
            historyItems.appendChild(item);
            if (focusedRunId === String(run.id || "")) item.querySelector(":scope > summary").focus({preventScroll: true});
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
        pendingAction = action;
        actionError = "";
        updateMenu(menu);
        const csrfToken = String(state.security?.investmentCsrfToken || "");
        const payload = action === "start"
            ? {ticker: currentTicker(), period: currentPeriod(), params: currentParameters()}
            : {run_id: runId};
        const url = endpoint(
            action === "start" ? "lstmTrainingStart" : "lstmTrainingStop",
            action === "start" ? "/api/lstm-training/start" : "/api/lstm-training/stop",
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
            const activeRun = cachedRuns.find((run) => run.active && run.ticker === currentTicker());
            postTrainingAction(menu, activeRun ? "stop" : "start", String(activeRun?.id || ""));
        });
        actions.appendChild(actionButton);
        menu.appendChild(actions);
        const liveStatus = appendText(menu, "lstm-training-live-status", "");
        liveStatus.dataset.lstmTrainingStatus = "true";
        liveStatus.setAttribute("role", "status");
        liveStatus.setAttribute("aria-live", "polite");

        const history = document.createElement("details");
        history.className = "lstm-training-history-collapse";
        history.dataset.lstmTrainingHistory = "true";
        history.open = true;
        const summary = document.createElement("summary");
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

    window.WORTHWARD_LSTM_TRAINING = {renderMenu};
})();
