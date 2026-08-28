/* Code version: v1.0.0-codex.1 */
(function installSharedAgentOptimization(sharedGlobal) {
    "use strict";

    const CONTRACT_VERSION = "1.0.0";
    const MANIFEST_ELEMENT_ID = "agent_optimization_manifest";
    const REGISTRATION_STATE_KEY = "__sharedAgentOptimizationRegistrationV1";
    const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
    const MAX_CAPABILITIES = 12;
    const MAX_NAVIGATION_TARGETS = 20;

    if (sharedGlobal.SHARED_AGENT_OPTIMIZATION) {
        return;
    }

    function isPlainObject(value) {
        return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }

    function normalizedText(value, label, maximumLength) {
        if (typeof value !== "string") {
            throw new TypeError(`${label} must be a string.`);
        }
        const normalized = value.trim();
        if (!normalized || normalized.length > maximumLength) {
            throw new TypeError(`${label} must contain 1 to ${maximumLength} characters.`);
        }
        return normalized;
    }

    function normalizedIdentifier(value, label) {
        const normalized = normalizedText(value, label, 64);
        if (!IDENTIFIER_PATTERN.test(normalized)) {
            throw new TypeError(`${label} must be a lowercase stable identifier.`);
        }
        return normalized;
    }

    function boundedText(value, maximumLength) {
        return String(value || "").trim().slice(0, maximumLength);
    }

    function safeErrorMessage(error) {
        if (error instanceof Error) {
            return boundedText(error.message, 200) || "Unknown registration error.";
        }
        return boundedText(error, 200) || "Unknown registration error.";
    }

    function cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function normalizedSameOriginPath(rawPath, locationLike) {
        const path = normalizedText(rawPath, "navigation path", 500);
        if (!path.startsWith("/")) {
            throw new TypeError("navigation path must be root-relative.");
        }
        const baseUrl = new URL(locationLike.href);
        const targetUrl = new URL(path, baseUrl);
        if (
            targetUrl.origin !== baseUrl.origin
            || targetUrl.username
            || targetUrl.password
        ) {
            throw new TypeError("navigation path must remain on the current origin.");
        }
        return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
    }

    function normalizedList(rawValue, label, maximumItems, normalizeItem) {
        if (!Array.isArray(rawValue) || rawValue.length > maximumItems) {
            throw new TypeError(`${label} must be an array with at most ${maximumItems} items.`);
        }
        const identifiers = new Set();
        return rawValue.map((rawItem, index) => {
            if (!isPlainObject(rawItem)) {
                throw new TypeError(`${label}[${index}] must be an object.`);
            }
            const item = normalizeItem(rawItem, index);
            if (identifiers.has(item.id)) {
                throw new TypeError(`${label} contains duplicate id ${item.id}.`);
            }
            identifiers.add(item.id);
            return item;
        });
    }

    function normalizeManifest(rawManifest, locationLike) {
        if (!isPlainObject(rawManifest)) {
            throw new TypeError("Agent Optimization manifest must be an object.");
        }
        if (rawManifest.contractVersion !== CONTRACT_VERSION) {
            throw new TypeError(`Unsupported Agent Optimization contract version ${rawManifest.contractVersion}.`);
        }
        if (rawManifest.status !== "project-convention") {
            throw new TypeError("Agent Optimization manifest status must be project-convention.");
        }
        if (!isPlainObject(rawManifest.site)) {
            throw new TypeError("Agent Optimization manifest site must be an object.");
        }

        const site = {
            id: normalizedIdentifier(rawManifest.site.id, "site.id"),
            name: normalizedText(rawManifest.site.name, "site.name", 80),
            description: normalizedText(rawManifest.site.description, "site.description", 300),
            privacyBoundary: normalizedText(
                rawManifest.site.privacyBoundary,
                "site.privacyBoundary",
                300,
            ),
        };
        const capabilities = normalizedList(
            rawManifest.capabilities,
            "capabilities",
            MAX_CAPABILITIES,
            (rawItem, index) => ({
                id: normalizedIdentifier(rawItem.id, `capabilities[${index}].id`),
                label: normalizedText(rawItem.label, `capabilities[${index}].label`, 80),
                description: normalizedText(
                    rawItem.description,
                    `capabilities[${index}].description`,
                    300,
                ),
            }),
        );
        const navigation = normalizedList(
            rawManifest.navigation,
            "navigation",
            MAX_NAVIGATION_TARGETS,
            (rawItem, index) => ({
                id: normalizedIdentifier(rawItem.id, `navigation[${index}].id`),
                label: normalizedText(rawItem.label, `navigation[${index}].label`, 80),
                description: normalizedText(
                    rawItem.description,
                    `navigation[${index}].description`,
                    300,
                ),
                path: normalizedSameOriginPath(rawItem.path, locationLike),
            }),
        );
        if (navigation.length === 0) {
            throw new TypeError("navigation must contain at least one allowlisted target.");
        }

        return {
            contractVersion: CONTRACT_VERSION,
            profile: normalizedText(rawManifest.profile, "profile", 100),
            status: "project-convention",
            site,
            capabilities,
            navigation,
        };
    }

    function parseManifest(documentLike, locationLike) {
        const element = documentLike.getElementById(MANIFEST_ELEMENT_ID);
        if (!element) {
            throw new TypeError(`Missing #${MANIFEST_ELEMENT_ID}.`);
        }
        return normalizeManifest(JSON.parse(element.textContent || ""), locationLike);
    }

    function readEffects() {
        return {
            pageNavigation: false,
            normalPageLoad: false,
            directPersistedDataMutation: false,
            pageLoadMayUseExistingDataFlows: false,
            externalAction: false,
        };
    }

    function resultEnvelope(tool, summary, data, verification, effects = readEffects()) {
        return {
            ok: true,
            tool,
            contractVersion: CONTRACT_VERSION,
            summary,
            data,
            effects,
            verification,
        };
    }

    function errorEnvelope(tool, code, message) {
        return {
            ok: false,
            tool,
            contractVersion: CONTRACT_VERSION,
            error: {
                code,
                message,
                retryable: false,
            },
            effects: readEffects(),
            verification: {
                executed: false,
            },
        };
    }

    function validateInputObject(input, allowedKeys, requiredKeys = []) {
        const normalizedInput = input === undefined ? {} : input;
        if (!isPlainObject(normalizedInput)) {
            return {error: "Input must be an object."};
        }
        const keys = Object.keys(normalizedInput);
        const unknownKey = keys.find((key) => !allowedKeys.includes(key));
        if (unknownKey) {
            return {error: `Unexpected input property ${unknownKey}.`};
        }
        const missingKey = requiredKeys.find((key) => !keys.includes(key));
        if (missingKey) {
            return {error: `Missing required input property ${missingKey}.`};
        }
        return {value: normalizedInput};
    }

    function currentRoute(locationLike) {
        const currentUrl = new URL(locationLike.href);
        return boundedText(
            `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
            1_000,
        );
    }

    function matchingNavigationTarget(manifest, locationLike) {
        const currentUrl = new URL(locationLike.href);
        const exactMatch = manifest.navigation.find((target) => {
            const targetUrl = new URL(target.path, currentUrl.origin);
            return targetUrl.pathname === currentUrl.pathname
                && targetUrl.search === currentUrl.search;
        });
        const pathMatch = manifest.navigation.find((target) => {
            const targetUrl = new URL(target.path, currentUrl.origin);
            return targetUrl.pathname === currentUrl.pathname && !targetUrl.search;
        });
        return exactMatch || pathMatch || null;
    }

    function buildToolDefinitions(manifest, environment) {
        const documentLike = environment.document;
        const locationLike = environment.location;
        const schedule = environment.schedule;
        const navigationIds = manifest.navigation.map((target) => target.id);

        return [
            {
                name: "get_site_capabilities",
                description: "Read the trusted, bounded capability and navigation inventory for this local application. This does not read user records or change application state.",
                inputSchema: {
                    type: "object",
                    properties: {},
                    additionalProperties: false,
                },
                annotations: {readOnlyHint: true},
                execute: async (input) => {
                    const validation = validateInputObject(input, []);
                    if (validation.error) {
                        return errorEnvelope(
                            "get_site_capabilities",
                            "invalid_input",
                            validation.error,
                        );
                    }
                    return resultEnvelope(
                        "get_site_capabilities",
                        `Found ${manifest.capabilities.length} capabilities and ${manifest.navigation.length} allowlisted destinations.`,
                        {
                            profile: manifest.profile,
                            site: cloneJson(manifest.site),
                            capabilities: cloneJson(manifest.capabilities),
                            navigation: cloneJson(manifest.navigation),
                        },
                        {
                            capabilityCount: manifest.capabilities.length,
                            navigationTargetCount: manifest.navigation.length,
                            bounded: true,
                        },
                    );
                },
            },
            {
                name: "get_page_context",
                description: "Read bounded metadata for the current top-level page, including its title, language, route, and matching allowlisted destination. This does not read page content or change application state.",
                inputSchema: {
                    type: "object",
                    properties: {},
                    additionalProperties: false,
                },
                annotations: {readOnlyHint: true},
                execute: async (input) => {
                    const validation = validateInputObject(input, []);
                    if (validation.error) {
                        return errorEnvelope(
                            "get_page_context",
                            "invalid_input",
                            validation.error,
                        );
                    }
                    const matchingTarget = matchingNavigationTarget(manifest, locationLike);
                    return resultEnvelope(
                        "get_page_context",
                        "Read bounded metadata for the current page.",
                        {
                            siteId: manifest.site.id,
                            title: boundedText(documentLike.title, 240),
                            language: boundedText(
                                documentLike.documentElement?.lang || "und",
                                35,
                            ),
                            route: currentRoute(locationLike),
                            matchingTarget: matchingTarget ? cloneJson(matchingTarget) : null,
                        },
                        {
                            topLevelPage: true,
                            contentFieldsRead: 0,
                            bounded: true,
                        },
                    );
                },
            },
            {
                name: "navigate_to_site_target",
                description: "Navigate the current top-level tab to one allowlisted destination in this local application. This changes the visible page and performs its normal page load, but it does not submit forms or directly request a data mutation.",
                inputSchema: {
                    type: "object",
                    properties: {
                        target: {
                            type: "string",
                            enum: navigationIds,
                            description: "Stable identifier of an allowlisted destination.",
                        },
                    },
                    required: ["target"],
                    additionalProperties: false,
                },
                annotations: {readOnlyHint: false},
                execute: async (input) => {
                    const validation = validateInputObject(input, ["target"], ["target"]);
                    if (validation.error || typeof validation.value?.target !== "string") {
                        return errorEnvelope(
                            "navigate_to_site_target",
                            "invalid_input",
                            validation.error || "target must be a string.",
                        );
                    }
                    const target = manifest.navigation.find(
                        (candidate) => candidate.id === validation.value.target,
                    );
                    if (!target) {
                        return errorEnvelope(
                            "navigate_to_site_target",
                            "unknown_target",
                            "target is not in the allowlisted navigation inventory.",
                        );
                    }
                    if (typeof locationLike.assign !== "function" || typeof schedule !== "function") {
                        return errorEnvelope(
                            "navigate_to_site_target",
                            "navigation_unavailable",
                            "This page cannot schedule same-origin navigation.",
                        );
                    }
                    try {
                        schedule(() => locationLike.assign(target.path), 0);
                    } catch (_error) {
                        return errorEnvelope(
                            "navigate_to_site_target",
                            "navigation_unavailable",
                            "This page could not schedule same-origin navigation.",
                        );
                    }
                    return resultEnvelope(
                        "navigate_to_site_target",
                        `Scheduled navigation to ${target.label}.`,
                        {
                            fromRoute: currentRoute(locationLike),
                            target: cloneJson(target),
                        },
                        {
                            sameOrigin: true,
                            allowlisted: true,
                            navigationScheduled: true,
                        },
                        {
                            pageNavigation: true,
                            normalPageLoad: true,
                            directPersistedDataMutation: false,
                            pageLoadMayUseExistingDataFlows: true,
                            externalAction: false,
                        },
                    );
                },
            },
        ];
    }

    async function registerToolDefinitions(modelContext, definitions) {
        const registered = [];
        const failed = [];
        for (const definition of definitions) {
            try {
                await modelContext.registerTool(definition);
                registered.push(definition.name);
            } catch (error) {
                failed.push({
                    name: definition.name,
                    message: safeErrorMessage(error),
                });
            }
        }
        return {
            status: failed.length ? "partial" : "registered",
            registered,
            failed,
        };
    }

    function rememberRegistration(documentLike, registrationPromise) {
        try {
            Object.defineProperty(documentLike, REGISTRATION_STATE_KEY, {
                value: registrationPromise,
                configurable: false,
                enumerable: false,
                writable: false,
            });
        } catch (_error) {
            try {
                documentLike[REGISTRATION_STATE_KEY] = registrationPromise;
            } catch (_ignored) {
            }
        }
    }

    function boot(environment = {}) {
        const documentLike = environment.document || sharedGlobal.document;
        const locationLike = environment.location || sharedGlobal.location;
        if (!documentLike || !locationLike) {
            return Promise.resolve({
                status: "no_document",
                contractVersion: CONTRACT_VERSION,
                registered: [],
                failed: [],
            });
        }
        const isTopLevel = environment.isTopLevel === undefined
            ? sharedGlobal.self === sharedGlobal.top
            : Boolean(environment.isTopLevel);
        if (!isTopLevel) {
            return Promise.resolve({
                status: "skipped_iframe",
                contractVersion: CONTRACT_VERSION,
                registered: [],
                failed: [],
            });
        }
        const modelContext = documentLike.modelContext;
        if (typeof modelContext?.registerTool !== "function") {
            return Promise.resolve({
                status: "unsupported",
                contractVersion: CONTRACT_VERSION,
                registered: [],
                failed: [],
            });
        }
        if (documentLike[REGISTRATION_STATE_KEY]) {
            return documentLike[REGISTRATION_STATE_KEY];
        }

        const registrationPromise = (async () => {
            try {
                const manifest = parseManifest(documentLike, locationLike);
                const definitions = buildToolDefinitions(manifest, {
                    document: documentLike,
                    location: locationLike,
                    schedule: environment.schedule || sharedGlobal.setTimeout?.bind(sharedGlobal),
                });
                const result = await registerToolDefinitions(modelContext, definitions);
                return {
                    ...result,
                    contractVersion: CONTRACT_VERSION,
                };
            } catch (error) {
                return {
                    status: "invalid_manifest",
                    contractVersion: CONTRACT_VERSION,
                    registered: [],
                    failed: [{
                        name: "manifest",
                        message: safeErrorMessage(error),
                    }],
                };
            }
        })();
        rememberRegistration(documentLike, registrationPromise);
        return registrationPromise;
    }

    const publicApi = Object.freeze({
        codeVersion: "v1.0.0-codex.1",
        contractVersion: CONTRACT_VERSION,
        manifestElementId: MANIFEST_ELEMENT_ID,
        normalizeManifest,
        parseManifest,
        buildToolDefinitions,
        registerToolDefinitions,
        boot,
    });
    Object.defineProperty(sharedGlobal, "SHARED_AGENT_OPTIMIZATION", {
        value: publicApi,
        configurable: false,
        enumerable: true,
        writable: false,
    });
    if (sharedGlobal.document) {
        void publicApi.boot();
    }
}(globalThis));
