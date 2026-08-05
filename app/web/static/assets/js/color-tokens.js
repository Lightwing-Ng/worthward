/* Code version: v0.1.0 */

(() => {
    const storageKey = "antigravity:color-token-overrides";
    const validModes = new Set(["light", "dark"]);
    const appliedTokenNames = new Set();
    let memoryOverrides = {light: {}, dark: {}};

    const getEffectiveMode = () => {
        const root = document.documentElement;
        const explicitMode = root.dataset.themeMode;
        if (explicitMode === "light" || explicitMode === "dark") return explicitMode;
        return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
    };

    const isValidColor = (value) => {
        const candidate = String(value ?? "").trim();
        if (!candidate) return false;
        return typeof window.CSS?.supports === "function" && window.CSS.supports("color", candidate);
    };

    const readOverrides = () => {
        try {
            if (!window.localStorage) return memoryOverrides;
            const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "{}");
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {light: {}, dark: {}};
            return {
                light: parsed.light && typeof parsed.light === "object" ? parsed.light : {},
                dark: parsed.dark && typeof parsed.dark === "object" ? parsed.dark : {},
            };
        } catch (_error) {
            return memoryOverrides;
        }
    };

    const writeOverrides = (overrides) => {
        memoryOverrides = overrides;
        try {
            if (!window.localStorage) return;
            window.localStorage.setItem(storageKey, JSON.stringify(overrides));
        } catch (_error) {
        }
    };

    const apply = (mode = getEffectiveMode()) => {
        const selectedMode = validModes.has(mode) ? mode : getEffectiveMode();
        const overrides = readOverrides();
        appliedTokenNames.forEach((tokenName) => {
            document.documentElement.style.removeProperty(tokenName);
        });
        appliedTokenNames.clear();
        Object.entries(overrides[selectedMode]).forEach(([tokenName, value]) => {
            if (!tokenName.startsWith("--theme-") || !isValidColor(value)) return;
            document.documentElement.style.setProperty(tokenName, String(value).trim());
            appliedTokenNames.add(tokenName);
        });
        window.dispatchEvent(new CustomEvent("antigravity:color-token-change", {
            detail: {mode: selectedMode, overrides: overrides[selectedMode]},
        }));
    };

    const getOverride = (tokenName, mode = getEffectiveMode()) => {
        const selectedMode = validModes.has(mode) ? mode : getEffectiveMode();
        return readOverrides()[selectedMode][tokenName] || "";
    };

    const setOverride = (tokenName, mode, value) => {
        const selectedMode = validModes.has(mode) ? mode : getEffectiveMode();
        const candidate = String(value ?? "").trim();
        if (!tokenName?.startsWith("--theme-") || !isValidColor(candidate)) return false;
        const overrides = readOverrides();
        overrides[selectedMode][tokenName] = candidate;
        writeOverrides(overrides);
        apply();
        return true;
    };

    const resetOverride = (tokenName, mode) => {
        const selectedMode = validModes.has(mode) ? mode : getEffectiveMode();
        const overrides = readOverrides();
        delete overrides[selectedMode][tokenName];
        writeOverrides(overrides);
        apply();
    };

    const resetAll = () => {
        memoryOverrides = {light: {}, dark: {}};
        try {
            window.localStorage.removeItem(storageKey);
        } catch (_error) {
        }
        apply();
    };

    window.ANTIGRAVITY_COLOR_TOKENS = {
        apply,
        getEffectiveMode,
        getOverride,
        isValidColor,
        resetAll,
        resetOverride,
        setOverride,
    };

    window.addEventListener("antigravity:theme-mode-change", () => apply());
    window.addEventListener("storage", (event) => {
        if (event.key === storageKey) apply();
    });
    const colorSchemeMedia = window.matchMedia?.("(prefers-color-scheme: dark)");
    colorSchemeMedia?.addEventListener?.("change", () => {
        if (!document.documentElement.dataset.themeMode || document.documentElement.dataset.themeMode === "system") apply();
    });
    apply();
})();
