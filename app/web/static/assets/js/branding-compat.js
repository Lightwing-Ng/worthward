/* Code version: v0.1.0 */
(() => {
    const legacyPrefix = "antigravity:";
    const currentPrefix = "worthward:";
    const globalAliases = [
        ["ANTIGRAVITY_APP", "WORTHWARD_APP"],
        ["ANTIGRAVITY_BACKTEST_PROBABILITY_GRID", "WORTHWARD_BACKTEST_PROBABILITY_GRID"],
        ["ANTIGRAVITY_BOOTSTRAP", "WORTHWARD_BOOTSTRAP"],
        ["ANTIGRAVITY_CHART_AXIS", "WORTHWARD_CHART_AXIS"],
        ["ANTIGRAVITY_CHIP_DISTRIBUTION", "WORTHWARD_CHIP_DISTRIBUTION"],
        ["ANTIGRAVITY_COLOR_TOKENS", "WORTHWARD_COLOR_TOKENS"],
        ["ANTIGRAVITY_DATE_PICKERS", "WORTHWARD_DATE_PICKERS"],
        ["ANTIGRAVITY_EXPORT_IMAGE", "WORTHWARD_EXPORT_IMAGE"],
        ["ANTIGRAVITY_INVESTMENT_DATA", "WORTHWARD_INVESTMENT_DATA"],
        ["ANTIGRAVITY_INVESTMENT_FILTERS", "WORTHWARD_INVESTMENT_FILTERS"],
        ["ANTIGRAVITY_INVESTMENT_MODULE_VERSIONS", "WORTHWARD_INVESTMENT_MODULE_VERSIONS"],
        ["ANTIGRAVITY_LOCAL_STORE_PAGINATION", "WORTHWARD_LOCAL_STORE_PAGINATION"],
        ["ANTIGRAVITY_NUMERIC_DISPLAY", "WORTHWARD_NUMERIC_DISPLAY"],
        ["ANTIGRAVITY_RESIZER", "WORTHWARD_RESIZER"],
        ["ANTIGRAVITY_RESPONSIVE", "WORTHWARD_RESPONSIVE"],
        ["ANTIGRAVITY_SEGMENTED_CONTROLS", "WORTHWARD_SEGMENTED_CONTROLS"],
        ["ANTIGRAVITY_TABLES", "WORTHWARD_TABLES"],
        ["ANTIGRAVITY_WORKSPACE_URL_STATE", "WORTHWARD_WORKSPACE_URL_STATE"],
    ];

    globalAliases.forEach(([legacyName, currentName]) => {
        try {
            Object.defineProperty(window, legacyName, {
                configurable: true,
                enumerable: false,
                get: () => window[currentName],
                set: (value) => {
                    window[currentName] = value;
                },
            });
        } catch (_error) {
            // A host embedding the app may already own a non-configurable alias.
        }
    });

    try {
        Object.defineProperty(window, "AntigravityMotion", {
            configurable: true,
            enumerable: false,
            get: () => window.WorthwardMotion,
            set: (value) => {
                window.WorthwardMotion = value;
            },
        });
    } catch (_error) {
        // A host embedding the app may already own the legacy motion alias.
    }

    const legacyStorageKey = (key) => {
        const normalized = String(key || "");
        return normalized.startsWith(currentPrefix)
            ? `${legacyPrefix}${normalized.slice(currentPrefix.length)}`
            : "";
    };

    const wrapStorage = (storage) => ({
        getItem(key) {
            const value = storage.getItem(key);
            if (value !== null) return value;
            const legacyKey = legacyStorageKey(key);
            if (!legacyKey) return null;
            const legacyValue = storage.getItem(legacyKey);
            if (legacyValue === null) return null;
            try {
                storage.setItem(key, legacyValue);
            } catch (_error) {
                // Read access remains useful when storage migration is unavailable.
            }
            return legacyValue;
        },
        setItem(key, value) {
            storage.setItem(key, value);
        },
        removeItem(key) {
            storage.removeItem(key);
            const legacyKey = legacyStorageKey(key);
            if (legacyKey) storage.removeItem(legacyKey);
        },
    });

    window.WORTHWARD_STORAGE = Object.freeze({
        local: wrapStorage(window.localStorage),
        session: wrapStorage(window.sessionStorage),
    });

    const eventNames = [
        "backtest-history-view-change",
        "backtest-probability-stage-minimum-change",
        "backtest-trade-details-change",
        "color-token-change",
        "date-picker-month-select",
        "export-image-config-change",
        "local-store-pagination-ready",
        "numeric-display-ready",
        "portfolio-preview",
        "settings-bootstrap-ready",
        "theme-mode-change",
        "ticker-order-change",
        "trade-detail-tab",
        "workspace-share-ready",
    ];
    const forwarded = Symbol("worthward-legacy-event-forwarded");
    const forwardEvent = (sourceName, targetName) => {
        window.addEventListener(sourceName, (event) => {
            if (event[forwarded]) return;
            const forwardedEvent = new CustomEvent(targetName, {
                bubbles: event.bubbles,
                cancelable: event.cancelable,
                detail: event.detail,
            });
            Object.defineProperty(forwardedEvent, forwarded, {value: true});
            window.dispatchEvent(forwardedEvent);
        });
    };
    eventNames.forEach((name) => {
        const currentName = `${currentPrefix}${name}`;
        const legacyName = `${legacyPrefix}${name}`;
        forwardEvent(currentName, legacyName);
        forwardEvent(legacyName, currentName);
    });
})();
