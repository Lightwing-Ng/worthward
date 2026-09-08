/* Code version: v0.12.0 */
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
    let cachedStrategy = "";
    const selectionKey = "worthward.lstm.selected-configuration.v1";
    let requestedSelectionId = new URL(window.location.href).searchParams.get("price_field_training_run")
        || new URL(window.location.href).searchParams.get("lstm_training_run") || "";
    let applyingRunId = "";
    let selectionValidationFrame = null;
    let selection = null;
    try { selection = JSON.parse(window.sessionStorage.getItem(selectionKey) || "null"); } catch { /* Storage is optional. */ }
    if (!selection || typeof selection.id !== "string" || !selection.configuration
        || typeof selection.configuration !== "object" || !selection.configuration.params) selection = null;
    let expandedRunId = selection?.id || "";
    const stoppingRunIds = new Set();
    const historySnapshots = new WeakMap();

    const currentStrategy = () => String(document.getElementById("trade_strategy")?.value || "");
    const isLegacyLstm = () => currentStrategy() === "lstm-price-field";
    const isLstmStrategySelected = () => isLegacyLstm() || Boolean(document.querySelector(
        '#trade_strategy_params_panel [data-strategy-action-slot="price-field-training"]',
    ));
    const trainingEndpoint = (action = "") => {
        const prefix = isLegacyLstm() ? "lstmTraining" : "priceFieldTraining";
        const suffix = action ? `${action[0].toUpperCase()}${action.slice(1)}` : "";
        const fallback = `/api/${isLegacyLstm() ? "lstm" : "price-field"}-training${action ? `/${action}` : ""}`;
        return endpoint(`${prefix}${suffix}`, fallback);
    };

    const endpoint = (name, fallback) => String(state.endpoints?.[name] || fallback);

    const privateMenuHost = () => document.querySelector(
        '#trade_strategy_params_panel [data-strategy-action-slot="lstm-training"], #trade_strategy_params_panel [data-strategy-action-slot="price-field-training"]',
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
        if (value) requestedSelectionId = value.id;
        else if (requestedSelectionId) {
            requestedSelectionId = "";
            const url = new URL(window.location.href);
            url.searchParams.delete("lstm_training_run");
            url.searchParams.delete("price_field_training_run");
            window.history.replaceState(window.history.state, "", url);
        }
        try {
            if (value) window.sessionStorage.setItem(selectionKey, JSON.stringify(value));
            else window.sessionStorage.removeItem(selectionKey);
        } catch { /* Selection still works for this page when storage is unavailable. */ }
    };

    const configurationMatches = (config) => {
        if (document.querySelector("#trade_strategy_params_panel [data-strategy-param-draft='1']")) return false;
        const current = {...currentConfiguration(), ticker: currentTicker(), period: currentPeriod(), interval: currentInterval()};
        const params = currentParameters();
        const same = (left, right) => typeof right === "number" ? Number(left) === right
            : typeof right === "boolean" ? [true, "true", "1", 1].includes(left) === right : left === right;
        return isLstmStrategySelected() && Object.entries(config).every(([key, value]) => {
            if (key === "strategy") return value === currentStrategy();
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
        if (selection?.id) url.searchParams.set(config.strategy === "lstm-price-field" ? "lstm_training_run" : "price_field_training_run", selection.id);
        return url;
    };

    const preserveSelectionUrl = (source) => {
        if (!selection || !configurationMatches(selection.configuration)) {
            if (!requestedSelectionId) return source;
            const pendingUrl = new URL(source, window.location.href);
            pendingUrl.searchParams.set(isLegacyLstm() ? "lstm_training_run" : "price_field_training_run", requestedSelectionId);
            return `${pendingUrl.pathname}${pendingUrl.search}${pendingUrl.hash}`;
        }
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
        applyingRunId = run.id;
        const workspace = document.getElementById("workspace_panel");
        if (workspace) workspace.dataset.workspacePending = "1";
        window.WORTHWARD_BOOTSTRAP?.setBacktestLoadState?.("loading");
        updateMenu(activeMenu);
        window.location.assign(configurationUrl(config).href);
        return true;
    };

    // Any explicit form edit detaches the saved case, even if the user later changes it back.
    const detachSelection = (event) => {
        if (!selection || !event.target.closest("[data-backtest-parameter-form]")
            || !event.target.matches("input, select, textarea")) return;
        if (applyingRunId) return;
        const detach = () => {
            saveSelection(null);
            if (activeMenu) updateMenu(activeMenu);
        };
        if (event.isTrusted) { detach(); return; }
        // Form hydration emits intermediate synthetic changes. Judge the final
        // configuration, not a partially restored ticker/parameter combination.
        if (document.readyState !== "complete") return;
        if (selectionValidationFrame !== null) cancelAnimationFrame(selectionValidationFrame);
        selectionValidationFrame = requestAnimationFrame(() => {
            selectionValidationFrame = null;
            if (selection && !configurationMatches(selection.configuration)) detach();
        });
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
        stopped: "Stopped",
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
        summary.title = run.configuration ? "Apply saved settings; forecasts are recomputed"
            : run.configuration_error || "View training details";
        summary.setAttribute("aria-expanded", String(expandedRunId === run.id));
        const loadState = window.WORTHWARD_BOOTSTRAP?.backtestLoadState || "loading";
        const selected = selection?.id === run.id;
        const loading = selected && (Boolean(applyingRunId) || loadState === "loading");
        summary.setAttribute("aria-pressed", String(selected && !applyingRunId && loadState === "ready"));
        summary.setAttribute("aria-busy", String(loading));
        if (loading) {
            const spinner = appendText(summary, "suggestion-loading-spinner lstm-training-apply-spinner", "");
            spinner.setAttribute("aria-label", "Loading saved configuration");
        }
        summary.setAttribute("aria-controls", `lstm-run-details-${run.id}`);
        const check = appendText(summary, "lstm-training-selected-icon", "");
        check.setAttribute("aria-hidden", "true");
        appendText(summary, "lstm-training-history-run", run.ticker || "Unknown ticker");
        const score = run.probability_score_pct ?? run.accuracy_pct;
        if (typeof score === "number" && Number.isFinite(score)) {
            const badge = appendText(summary, "investment-holdings-allocation-badge lstm-training-accuracy", `${formatNumber(score, 2)}%`);
            badge.title = run.probability_score_pct !== null && run.probability_score_pct !== undefined
                ? run.probability_score_label : run.accuracy_label || "Holdout direction accuracy";
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
        if (run.device) {
            const device = run.device;
            const compute = [`Backend ${device.resolved}`];
            if (Number.isFinite(device.optimizer_steps)) compute.push(`${formatNumber(device.optimizer_steps)} optimizer steps`);
            if (Number.isFinite(device.train_ms) && device.train_ms >= 0) compute.push(`${formatNumber(device.train_ms / 1000, 2)} s training`);
            if (Number.isFinite(device.infer_ms) && device.infer_ms >= 0) compute.push(`${formatNumber(device.infer_ms / 1000, 2)} s inference`);
            if (!Number.isFinite(device.train_ms) && Number.isFinite(device.training_compute_seconds)) {
                compute.push(`${formatNumber(device.training_compute_seconds, 2)} s compute`);
            }
            appendText(details, "lstm-training-history-meta", compute.join(" · "));
        }
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
        if (!applyingRunId && lastFetchedAt && selection && !configurationMatches(selection.configuration)) saveSelection(null);
        menu.closest('[data-collapse="training"]')?.querySelector('.lstm-training-spinner')?.remove();
        const liveProgress = menu.querySelector("[data-lstm-training-progress]");
        const progressRun = activeRun || (pendingAction === "start"
            ? {ticker, status: "starting", active: true} : null);
        if (liveProgress) liveProgress.replaceChildren(...(progressRun ? [buildProgress(progressRun)] : []));
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
            status.textContent = actionError || historyError || (applyingRunId ? "Loading saved configuration…"
                : lastFetchedAt && protocolVersion < 2 ? "Restart the local service to enable updated training controls." : "");
            status.hidden = !status.textContent;
        }

        const count = menu.querySelector("[data-lstm-training-count]");
        const historyRuns = cachedRuns.filter((run) => !run.active);
        if (count instanceof HTMLElement) count.textContent = formatNumber(historyRuns.length);
        const historyItems = menu.querySelector("[data-lstm-training-history-items]");
        if (!(historyItems instanceof HTMLElement)) return;
        const snapshot = JSON.stringify([historyRuns, expandedRunId, selection?.id, pendingAction, applyingRunId, protocolVersion, window.WORTHWARD_BOOTSTRAP?.backtestLoadState]);
        if (historySnapshots.get(historyItems) === snapshot) return;
        historySnapshots.set(historyItems, snapshot);
        const focusedRunId = document.activeElement?.closest("[data-lstm-training-run-id]")?.dataset.lstmTrainingRunId;
        historyItems.replaceChildren();
        if (!historyRuns.length) {
            appendText(historyItems, "lstm-training-history-empty", isLegacyLstm()
                ? "No historical LSTM training runs." : "No historical training runs for this model.");
            return;
        }
        const identifiers = historyIdentifiers(cachedRuns);
        historyRuns.forEach((run) => {
            const item = buildHistoryItem(run, run.identifier || identifiers.get(run.id));
            const entry = document.createElement("div");
            entry.className = "lstm-training-history-entry";
            entry.appendChild(item);
            if (run.status !== "completed") appendText(entry, "lstm-training-status", statusLabel(run.status));
            if (run.error && run.status !== "completed") {
                const gpuAutoFailure = run.selected_params?.compute_backend === "Auto"
                    && String(run.error).includes("requires a working PyTorch MPS or CUDA GPU");
                const failure = appendText(entry, "lstm-training-history-error", gpuAutoFailure
                    ? "Auto run required an unavailable GPU." : String(run.error));
                failure.title = String(run.error);
            }
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
        const selectedStrategy = currentStrategy();
        const url = new URL(trainingEndpoint(), window.location.href);
        if (!isLegacyLstm()) url.searchParams.set("strategy", selectedStrategy);
        fetchInFlight = fetch(url, {credentials: "same-origin", cache: "no-store"})
            .then(async (response) => {
                const payload = await response.json().catch(() => ({}));
                if (selectedStrategy !== currentStrategy()) return;
                if (!response.ok || payload.success === false) {
                    throw new Error(payload.error || "Training history is unavailable.");
                }
                cachedRuns = Array.isArray(payload.runs) ? payload.runs.filter((run) => (
                    selectedStrategy === "lstm-price-field" || run.strategy === selectedStrategy
                )) : [];
                protocolVersion = Number(payload.protocol_version || 0);
                if (requestedSelectionId && !applyingRunId) {
                    const requested = cachedRuns.find((run) => run.id === requestedSelectionId);
                    if (requested?.configuration && configurationMatches(requested.configuration)) {
                        saveSelection({id: requested.id, configuration: requested.configuration});
                        expandedRunId ||= requested.id;
                    } else saveSelection(null);
                }
                if (selection && !cachedRuns.some((run) => run.id === selection.id && run.configuration)) saveSelection(null);
                stoppingRunIds.forEach((id) => {
                    if (!cachedRuns.some((run) => run.id === id && run.active)) stoppingRunIds.delete(id);
                });
                lastFetchedAt = Date.now();
                historyError = "";
            })
            .catch((error) => {
                if (selectedStrategy === currentStrategy()) historyError = error.message || "Training history is unavailable.";
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
            actionError = "Training requires Interval 1d. Select 1d to train.";
            updateMenu(menu);
            return;
        }
        pendingAction = action;
        actionError = "";
        updateMenu(menu);
        const csrfToken = String(state.security?.investmentCsrfToken || "");
        const payload = action === "start"
            ? {strategy: currentStrategy(), ticker: currentTicker(), period: currentPeriod(), interval: currentInterval(), params: currentParameters(), configuration: currentConfiguration()}
            : {run_id: runId};
        const url = trainingEndpoint(action);
        const selectedStrategy = currentStrategy();
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
                throw new Error(result.error || "The training action failed.");
            }
            if (selectedStrategy !== currentStrategy()) return;
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
            if (selectedStrategy === currentStrategy()) actionError = error.message || "The training action failed.";
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
        if (cachedStrategy !== currentStrategy()) {
            cachedStrategy = currentStrategy();
            cachedRuns = [];
            lastFetchedAt = 0;
            protocolVersion = 0;
            actionError = "";
            historyError = "";
        }
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

    window.WORTHWARD_PRICE_FIELD_TRAINING = {renderMenu, preserveSelectionUrl};
    window.WORTHWARD_LSTM_TRAINING = window.WORTHWARD_PRICE_FIELD_TRAINING;
})();
