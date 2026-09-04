/* Code version: v0.2.0 */
(() => {
    const state = window.WORTHWARD_APP || {};
    const POLL_INTERVAL_MS = 5000;
    let activeMenu = null;
    let pollTimer = null;
    let cachedRuns = [];
    let lastFetchedAt = 0;
    let fetchInFlight = null;

    const isLstmStrategySelected = () => (
        String(document.getElementById("trade_strategy")?.value || "") === "lstm-price-field"
    );

    const endpoint = (name, fallback) => String(state.endpoints?.[name] || fallback);

    const privateMenuHost = () => document.querySelector("[data-lstm-training-private-menu]");

    const currentTicker = () => String(
        document.querySelector("[data-ticker-input]")?.value || "",
    ).trim().toUpperCase();

    const currentPeriod = () => String(document.getElementById("period")?.value || "1y").trim().toLowerCase();

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
        button.className = "lstm-training-action";
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
        appendText(details, "lstm-training-history-meta", `Started ${formatDate(run.started_at)}`);
        if (run.completed_at) appendText(details, "lstm-training-history-meta", `Completed ${formatDate(run.completed_at)}`);
        const progress = [];
        if (Number.isFinite(Number(run.generation))) progress.push(`Generation ${formatNumber(run.generation)}`);
        if (Number.isFinite(Number(run.evaluated))) progress.push(`${formatNumber(run.evaluated)} evaluations`);
        if (progress.length) appendText(details, "lstm-training-history-meta", progress.join(" · "));
        const best = run.best || {};
        if (Number.isFinite(Number(best.holdout_median_hit_rate_pct))) {
            appendText(details, "lstm-training-history-meta", `Holdout median hit rate ${formatNumber(best.holdout_median_hit_rate_pct, 2)}%`);
        }
        if (best.params && typeof best.params === "object") {
            const parameterText = Object.entries(best.params)
                .map(([key, value]) => `${key}=${value}`)
                .join(" · ");
            if (parameterText) appendText(details, "lstm-training-history-meta", `Best parameters ${parameterText}`);
        }
        if (run.error) appendText(details, "lstm-training-history-error", run.error);
        item.appendChild(details);
        return item;
    };

    const updateMenu = (menu, message = "") => {
        if (!(menu instanceof HTMLElement)) return;
        const ticker = currentTicker();
        const activeRun = cachedRuns.find((run) => run.active && run.ticker === ticker) || null;
        const startButton = menu.querySelector("[data-lstm-training-action='start']");
        const stopButton = menu.querySelector("[data-lstm-training-action='stop']");
        if (startButton instanceof HTMLButtonElement) startButton.disabled = Boolean(activeRun);
        if (stopButton instanceof HTMLButtonElement) stopButton.disabled = !activeRun;

        const status = menu.querySelector("[data-lstm-training-status]");
        if (status instanceof HTMLElement) {
            status.textContent = message || (activeRun
                ? `${statusLabel(activeRun.status)} for ${activeRun.ticker} · ${activeRun.period}`
                : "Ready to start a local 12-hour LSTM tuning run.");
        }

        const count = menu.querySelector("[data-lstm-training-count]");
        if (count instanceof HTMLElement) count.textContent = String(cachedRuns.length);
        const historyItems = menu.querySelector("[data-lstm-training-history-items]");
        if (!(historyItems instanceof HTMLElement)) return;
        const openIds = new Set(
            Array.from(historyItems.querySelectorAll("details[open]"))
                .map((item) => item.dataset.lstmTrainingRunId)
                .filter(Boolean),
        );
        historyItems.replaceChildren();
        if (!cachedRuns.length) {
            appendText(historyItems, "lstm-training-history-empty", "No historical LSTM training runs.");
            return;
        }
        cachedRuns.forEach((run) => {
            const item = buildHistoryItem(run);
            if (openIds.has(String(run.id || ""))) item.open = true;
            historyItems.appendChild(item);
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
                lastFetchedAt = Date.now();
            })
            .catch((error) => {
                updateMenu(menu, error.message || "LSTM training history is unavailable.");
            })
            .finally(() => {
                fetchInFlight = null;
            });
        await fetchInFlight;
        updateMenu(menu);
    };

    const postTrainingAction = async (menu, action, runId = "") => {
        const button = menu.querySelector(`[data-lstm-training-action='${action}']`);
        if (button instanceof HTMLButtonElement) button.disabled = true;
        updateMenu(menu, action === "start" ? "Starting LSTM training…" : "Stopping LSTM training…");
        const csrfToken = String(state.security?.investmentCsrfToken || "");
        const payload = action === "start"
            ? {ticker: currentTicker(), period: currentPeriod()}
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
            lastFetchedAt = 0;
            await refreshRuns(menu, true);
        } catch (error) {
            updateMenu(menu, error.message || "The LSTM training action failed.");
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
            if (cachedRuns.some((run) => run.active && run.ticker === currentTicker())) {
                refreshRuns(menu, true);
            }
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
        const heading = document.createElement("div");
        heading.className = "lstm-training-menu-heading";
        appendText(heading, "lstm-training-menu-title", "Train LSTM");
        appendText(heading, "lstm-training-menu-copy", "Local tuning run");
        menu.appendChild(heading);

        const actions = document.createElement("div");
        actions.className = "lstm-training-actions";
        const startButton = buildActionButton("start", "Start training", "lstm-training-start-icon");
        const stopButton = buildActionButton("stop", "Stop training", "lstm-training-stop-icon");
        startButton.addEventListener("click", (event) => {
            event.stopPropagation();
            postTrainingAction(menu, "start");
        });
        stopButton.addEventListener("click", (event) => {
            event.stopPropagation();
            const activeRun = cachedRuns.find((run) => run.active && run.ticker === currentTicker());
            if (activeRun) postTrainingAction(menu, "stop", String(activeRun.id || ""));
        });
        actions.appendChild(startButton);
        actions.appendChild(stopButton);
        menu.appendChild(actions);
        const liveStatus = appendText(menu, "lstm-training-live-status", "Ready to start a local 12-hour LSTM tuning run.");
        liveStatus.dataset.lstmTrainingStatus = "true";
        liveStatus.setAttribute("role", "status");
        liveStatus.setAttribute("aria-live", "polite");

        const history = document.createElement("details");
        history.className = "lstm-training-history-collapse";
        history.dataset.lstmTrainingHistory = "true";
        const summary = document.createElement("summary");
        appendText(summary, "lstm-training-history-title", "Historical LSTM training");
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
