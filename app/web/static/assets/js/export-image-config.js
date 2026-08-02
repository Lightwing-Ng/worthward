/**
 * Shared export-image configuration registry.
 *
 * Code version: v0.1.1
 * Settings previews and screenshot exporters use this contract so a token
 * edited in Settings is also applied to the detached export DOM.
 */
(() => {
    "use strict";

    const MODULE_VERSION = "v0.1.1";
    const STORAGE_KEY = "antigravity:export-image-config:v1";
    const DEFAULT_PROFILE_ID = "investment-community-share";
    const profiles = new Map();

    const isFiniteNumber = (value) => Number.isFinite(Number(value));

    const normalizeProfileId = (value) => String(value || "").trim().toLowerCase();

    const normalizeCssTokenValue = (tokenName, value, fallback) => {
        const normalized = String(value ?? "").trim();
        if (!normalized) return fallback;
        if (tokenName.endsWith("-accent")) {
            return /^#[0-9a-f]{6,8}$/i.test(normalized) ? normalized : fallback;
        }
        if (tokenName.endsWith("-print-width") || tokenName.endsWith("-print-height")
            || tokenName.endsWith("-print-radius")) {
            return /^\d+(?:\.\d+)?mm$/i.test(normalized) ? normalized : fallback;
        }
        if (tokenName.endsWith("-width") || tokenName.endsWith("-height")
            || tokenName.endsWith("-radius") || tokenName.endsWith("-padding")
            || tokenName.endsWith("-gap") || tokenName.endsWith("-size")) {
            return /^\d+(?:\.\d+)?px$/i.test(normalized) ? normalized : fallback;
        }
        return normalized;
    };

    const readStoredState = () => {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch (_error) {
            return {};
        }
    };

    const writeStoredState = (state) => {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            return true;
        } catch (_error) {
            return false;
        }
    };

    const parsePixels = (value, fallback) => {
        const parsed = Number.parseFloat(String(value || "").trim());
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };

    const getProfileDefinition = (profileId = DEFAULT_PROFILE_ID) => (
        profiles.get(normalizeProfileId(profileId)) || profiles.get(DEFAULT_PROFILE_ID) || null
    );

    const buildProfileConfig = (profileId = DEFAULT_PROFILE_ID) => {
        const profile = getProfileDefinition(profileId);
        if (!profile) return null;
        const storedState = readStoredState();
        const storedTokens = storedState.profiles?.[profile.id]?.tokens;
        const tokens = {};
        Object.entries(profile.defaults).forEach(([tokenName, defaultValue]) => {
            const storedValue = storedTokens && typeof storedTokens === "object"
                ? storedTokens[tokenName]
                : undefined;
            tokens[tokenName] = normalizeCssTokenValue(tokenName, storedValue, defaultValue);
        });
        const shellWidth = parsePixels(tokens["--investment-community-share-shell-width"], 1080);
        const shellHeight = parsePixels(tokens["--investment-community-share-shell-height"], 1730);
        const derived = typeof profile.derive === "function"
            ? profile.derive({tokens, shellWidth, shellHeight})
            : {};
        return {
            id: profile.id,
            template: profile.template,
            tokens: {...tokens},
            derived: {...derived},
        };
    };

    const applyProfileConfig = (target, profileId = DEFAULT_PROFILE_ID) => {
        if (!(target instanceof HTMLElement)) return null;
        const config = buildProfileConfig(profileId);
        if (!config) return null;
        const values = {...config.tokens, ...config.derived};
        Object.entries(values).forEach(([tokenName, value]) => {
            if (value !== undefined && value !== null) {
                target.style.setProperty(tokenName, String(value));
            }
        });
        target.dataset.exportImageProfile = config.id;
        target.dataset.exportImageTemplate = config.template;
        return config;
    };

    const applyProfileConfigToTargets = (targets, profileId = DEFAULT_PROFILE_ID) => {
        const uniqueTargets = Array.from(new Set(Array.isArray(targets) ? targets : [targets]));
        let config = null;
        uniqueTargets.forEach((target) => {
            const nextConfig = applyProfileConfig(target, profileId);
            if (nextConfig) config = nextConfig;
        });
        return config;
    };

    const emitConfigChange = (profileId, config) => {
        if (typeof window.dispatchEvent !== "function" || typeof window.CustomEvent !== "function") return;
        window.dispatchEvent(new window.CustomEvent("antigravity:export-image-config-change", {
            detail: {
                profileId,
                config,
            },
        }));
    };

    const setProfileToken = (tokenName, value, {
        profileId = DEFAULT_PROFILE_ID,
        targets = null,
    } = {}) => {
        const profile = getProfileDefinition(profileId);
        if (!profile || !Object.prototype.hasOwnProperty.call(profile.defaults, tokenName)) return null;
        const currentConfig = buildProfileConfig(profile.id);
        const nextValue = normalizeCssTokenValue(tokenName, value, currentConfig.tokens[tokenName]);
        const state = readStoredState();
        state.version = 1;
        state.profiles = state.profiles && typeof state.profiles === "object" ? state.profiles : {};
        const storedProfile = state.profiles[profile.id] && typeof state.profiles[profile.id] === "object"
            ? state.profiles[profile.id]
            : {};
        storedProfile.tokens = storedProfile.tokens && typeof storedProfile.tokens === "object"
            ? storedProfile.tokens
            : {};
        storedProfile.tokens[tokenName] = nextValue;
        state.profiles[profile.id] = storedProfile;
        writeStoredState(state);

        const nextConfig = buildProfileConfig(profile.id);
        const applyTargets = targets ? (Array.isArray(targets) ? targets : [targets]) : [document.documentElement];
        applyProfileConfigToTargets(applyTargets, profile.id);
        emitConfigChange(profile.id, nextConfig);
        return nextConfig;
    };

    const resetProfile = (profileId = DEFAULT_PROFILE_ID, targets = null) => {
        const normalizedProfileId = normalizeProfileId(profileId);
        const state = readStoredState();
        if (state.profiles && typeof state.profiles === "object") {
            delete state.profiles[normalizedProfileId];
            writeStoredState(state);
        }
        const applyTargets = targets ? (Array.isArray(targets) ? targets : [targets]) : [document.documentElement];
        const config = applyProfileConfigToTargets(applyTargets, normalizedProfileId);
        emitConfigChange(normalizedProfileId, config);
        return config;
    };

    const registerProfile = (profileId, {
        template = "stable-v1",
        defaults = {},
        derive = null,
    } = {}) => {
        const normalizedProfileId = normalizeProfileId(profileId);
        if (!normalizedProfileId || profiles.has(normalizedProfileId) || !defaults || typeof defaults !== "object") {
            return false;
        }
        profiles.set(normalizedProfileId, {
            id: normalizedProfileId,
            template: String(template || "stable-v1").trim() || "stable-v1",
            defaults: Object.freeze({...defaults}),
            derive,
        });
        return true;
    };

    registerProfile(DEFAULT_PROFILE_ID, {
        template: "stable-v1",
        defaults: {
            "--investment-community-share-print-width": "53.98mm",
            "--investment-community-share-print-height": "86.50mm",
            "--investment-community-share-print-radius": "3.18mm",
            "--investment-community-share-accent": "#0055cc",
            "--investment-community-share-shell-width": "1080px",
            "--investment-community-share-shell-height": "1730px",
            "--investment-community-share-card-radius": "31.8px",
            "--investment-community-share-safe-padding": "10px",
            "--investment-community-share-card-gap": "10px",
            "--investment-community-share-section-gap": "10px",
            "--investment-community-share-section-radius": "16px",
            "--investment-community-share-footer-brand-size": "72px",
            "--investment-community-share-footer-qr-size": "108px",
            "--investment-community-share-ticker-identity-logo-size": "36px",
        },
        derive: ({shellWidth, shellHeight}) => ({
            "--investment-community-share-logical-width": `${shellWidth / 2}px`,
            "--investment-community-share-logical-height": `${shellHeight / 2}px`,
            "--investment-community-share-export-scale": "2",
            "--investment-community-share-ticker-identity-logo-base": "20px",
        }),
    });

    const api = {
        version: MODULE_VERSION,
        storageKey: STORAGE_KEY,
        defaultProfileId: DEFAULT_PROFILE_ID,
        registerProfile,
        getProfileIds: () => Array.from(profiles.keys()),
        getConfig: buildProfileConfig,
        applyConfig: applyProfileConfig,
        applyConfigToTargets: applyProfileConfigToTargets,
        setToken: setProfileToken,
        resetProfile,
        isFiniteNumber,
    };

    window.ANTIGRAVITY_EXPORT_IMAGE = Object.freeze(api);
    applyProfileConfig(document.documentElement, DEFAULT_PROFILE_ID);
})();
