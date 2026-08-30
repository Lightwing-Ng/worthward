/* Code version: v1.1.0-codex.1 */
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {pathToFileURL} from 'node:url';

const projectRoot = process.cwd();
const cacheRuntimePath = path.join(
    projectRoot,
    'app/web/static/agent-optimization.js',
);
const antigravityRuntimePath = path.join(
    projectRoot,
    'app/web/static/assets/js/agent-optimization.js',
);
const runtimePath = existsSync(cacheRuntimePath)
    ? cacheRuntimePath
    : antigravityRuntimePath;

await import(pathToFileURL(runtimePath).href);

const runtime = globalThis.SHARED_AGENT_OPTIMIZATION;

const createLocation = (initialHref = 'http://127.0.0.1:8699/alpha?mode=read') => {
    let href = initialHref;
    const assigned = [];
    return {
        get href() {
            return href;
        },
        get assigned() {
            return [...assigned];
        },
        assign(target) {
            assigned.push(target);
            href = new URL(target, href).href;
        },
    };
};

const rawManifest = () => ({
    contractVersion: '1.1.0',
    profile: 'openai-site-tools-2026-08-28',
    status: 'project-convention',
    site: {
        id: 'test-site',
        name: 'Test site',
        description: 'A deterministic local application fixture.',
        privacyBoundary: 'User records are not returned by the shared v1 tools.',
    },
    capabilities: [
        {
            id: 'review',
            label: 'Review',
            description: 'Review deterministic application state.',
        },
    ],
    navigation: [
        {
            id: 'alpha',
            label: 'Alpha',
            description: 'Open the Alpha page.',
            path: '/alpha',
        },
        {
            id: 'beta',
            label: 'Beta',
            description: 'Open the Beta page.',
            path: '/beta?mode=review',
        },
    ],
    webmcpTools: [
        {
            name: 'get_site_capabilities',
            description: 'Read the bounded capability inventory for this fixture.',
            inputSchema: {
                type: 'object',
                properties: {},
                required: [],
                additionalProperties: false,
            },
            readOnlyHint: true,
        },
        {
            name: 'get_page_context',
            description: 'Read bounded metadata for the current fixture page.',
            inputSchema: {
                type: 'object',
                properties: {},
                required: [],
                additionalProperties: false,
            },
            readOnlyHint: true,
        },
        {
            name: 'navigate_to_site_target',
            description: 'Navigate to one allowlisted fixture destination.',
            inputSchema: {
                type: 'object',
                properties: {
                    target: {
                        type: 'string',
                        description: 'Stable fixture destination identifier.',
                    },
                },
                required: ['target'],
                additionalProperties: false,
            },
            readOnlyHint: false,
        },
    ],
});

const createDocument = ({manifest = rawManifest(), registerTool} = {}) => ({
    title: 'Fixture title',
    documentElement: {lang: 'en-US'},
    modelContext: registerTool ? {registerTool} : undefined,
    getElementById(id) {
        return id === runtime.manifestElementId
            ? {textContent: JSON.stringify(manifest)}
            : null;
    },
});

test('the shared runtime publishes its explicit contract version', () => {
    assert.equal(runtime.codeVersion, 'v1.1.0-codex.1');
    assert.equal(runtime.contractVersion, '1.1.0');
    assert.equal(runtime.manifestElementId, 'agent_optimization_manifest');
});

test('manifest normalization enforces stable identifiers and same-origin paths', () => {
    const location = createLocation();
    const normalized = runtime.normalizeManifest(rawManifest(), location);

    assert.deepEqual(
        normalized.webmcpTools.map(({name, readOnlyHint}) => ({name, readOnlyHint})),
        [
            {name: 'get_site_capabilities', readOnlyHint: true},
            {name: 'get_page_context', readOnlyHint: true},
            {name: 'navigate_to_site_target', readOnlyHint: false},
        ],
    );

    assert.deepEqual(
        normalized.navigation.map(({id, path: targetPath}) => ({id, path: targetPath})),
        [
            {id: 'alpha', path: '/alpha'},
            {id: 'beta', path: '/beta?mode=review'},
        ],
    );

    const duplicate = rawManifest();
    duplicate.navigation[1].id = 'alpha';
    assert.throws(
        () => runtime.normalizeManifest(duplicate, location),
        /duplicate id alpha/,
    );

    const external = rawManifest();
    external.navigation[0].path = '//example.com/private';
    assert.throws(
        () => runtime.normalizeManifest(external, location),
        /current origin/,
    );

    const invalidIdentifier = rawManifest();
    invalidIdentifier.site.id = 'Invalid Site';
    assert.throws(
        () => runtime.normalizeManifest(invalidIdentifier, location),
        /lowercase stable identifier/,
    );
});

test('tool definitions remain small, closed, and accurately annotated', () => {
    const location = createLocation();
    const manifest = runtime.normalizeManifest(rawManifest(), location);
    const definitions = runtime.buildToolDefinitions(manifest, {
        document: createDocument(),
        location,
        schedule() {},
    });

    assert.deepEqual(
        definitions.map(({name}) => name),
        [
            'get_site_capabilities',
            'get_page_context',
            'navigate_to_site_target',
        ],
    );
    assert.deepEqual(
        definitions.map(({annotations}) => annotations.readOnlyHint),
        [true, true, false],
    );
    for (const definition of definitions) {
        assert.equal(definition.inputSchema.type, 'object');
        assert.equal(definition.inputSchema.additionalProperties, false);
        assert.ok(definition.description.length > 20);
    }
    assert.deepEqual(
        definitions[2].inputSchema.properties.target.enum,
        ['alpha', 'beta'],
    );
    assert.match(definitions[2].description, /allowlisted fixture destination/);
});

test('read tools return bounded verification envelopes and reject extra input', async () => {
    const location = createLocation();
    const manifest = runtime.normalizeManifest(rawManifest(), location);
    const [capabilitiesTool, pageTool] = runtime.buildToolDefinitions(manifest, {
        document: createDocument(),
        location,
        schedule() {},
    });

    const capabilities = await capabilitiesTool.execute({});
    assert.equal(capabilities.ok, true);
    assert.equal(capabilities.tool, 'get_site_capabilities');
    assert.equal(capabilities.verification.capabilityCount, 1);
    assert.equal(capabilities.verification.navigationTargetCount, 2);
    assert.equal(capabilities.verification.webmcpToolCount, 3);
    assert.equal(capabilities.data.webmcpTools.length, 3);
    assert.equal(capabilities.effects.directPersistedDataMutation, false);
    assert.doesNotThrow(() => JSON.stringify(capabilities));

    const context = await pageTool.execute();
    assert.equal(context.ok, true);
    assert.equal(context.data.route, '/alpha?mode=read');
    assert.equal(context.data.matchingTarget.id, 'alpha');
    assert.equal(context.verification.contentFieldsRead, 0);

    const rejected = await pageTool.execute({selector: 'body'});
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, 'invalid_input');
    assert.equal(rejected.verification.executed, false);
});

test('navigation accepts only a manifest target and returns evidence before assignment', async () => {
    const location = createLocation();
    const scheduled = [];
    const manifest = runtime.normalizeManifest(rawManifest(), location);
    const navigationTool = runtime.buildToolDefinitions(manifest, {
        document: createDocument(),
        location,
        schedule(callback) {
            scheduled.push(callback);
        },
    })[2];

    const result = await navigationTool.execute({target: 'beta'});
    assert.equal(result.ok, true);
    assert.equal(result.data.fromRoute, '/alpha?mode=read');
    assert.equal(result.data.target.path, '/beta?mode=review');
    assert.equal(result.effects.pageNavigation, true);
    assert.equal(result.effects.directPersistedDataMutation, false);
    assert.equal(result.effects.pageLoadMayUseExistingDataFlows, true);
    assert.equal(result.verification.sameOrigin, true);
    assert.deepEqual(location.assigned, []);
    assert.equal(scheduled.length, 1);

    scheduled[0]();
    assert.deepEqual(location.assigned, ['/beta?mode=review']);

    const unknown = await navigationTool.execute({target: 'private'});
    assert.equal(unknown.ok, false);
    assert.equal(unknown.error.code, 'unknown_target');
    const extra = await navigationTool.execute({target: 'alpha', url: 'https://example.com'});
    assert.equal(extra.ok, false);
    assert.equal(extra.error.code, 'invalid_input');
    assert.equal(scheduled.length, 1);
});

test('boot is a silent no-op without WebMCP and skips iframe documents', async () => {
    const unsupportedDocument = {
        getElementById() {
            throw new Error('The manifest must not be read when WebMCP is unavailable.');
        },
    };
    const unsupported = await runtime.boot({
        document: unsupportedDocument,
        location: createLocation(),
        isTopLevel: true,
    });
    assert.equal(unsupported.status, 'unsupported');

    const iframe = await runtime.boot({
        document: createDocument({registerTool: async () => {}}),
        location: createLocation(),
        isTopLevel: false,
    });
    assert.equal(iframe.status, 'skipped_iframe');
});

test('boot registers every definition once and contains a single registration failure', async () => {
    const registrations = [];
    const document = createDocument({
        registerTool: async (definition) => {
            registrations.push(definition);
            if (definition.name === 'get_page_context') {
                throw new Error('fixture registration failure');
            }
        },
    });
    const environment = {
        document,
        location: createLocation(),
        isTopLevel: true,
        schedule() {},
    };

    const firstBoot = runtime.boot(environment);
    const secondBoot = runtime.boot(environment);
    assert.strictEqual(firstBoot, secondBoot);
    const result = await firstBoot;

    assert.equal(result.status, 'partial');
    assert.deepEqual(result.registered, [
        'get_site_capabilities',
        'navigate_to_site_target',
    ]);
    assert.deepEqual(result.failed, [{
        name: 'get_page_context',
        message: 'fixture registration failure',
    }]);
    assert.equal(registrations.length, 3);
});

test('boot contains malformed manifest errors without affecting the page', async () => {
    const result = await runtime.boot({
        document: createDocument({
            manifest: {contractVersion: '99.0.0'},
            registerTool: async () => {},
        }),
        location: createLocation(),
        isTopLevel: true,
        schedule() {},
    });

    assert.equal(result.status, 'invalid_manifest');
    assert.deepEqual(result.registered, []);
    assert.equal(result.failed[0].name, 'manifest');
    assert.match(result.failed[0].message, /Unsupported Agent Optimization contract version/);
});

const siblingRuntimePaths = [
    path.join(projectRoot, '..', 'CacheLikesFromTwitter', 'app/web/static/agent-optimization.js'),
    path.join(projectRoot, '..', 'antigravity', 'app/web/static/assets/js/agent-optimization.js'),
];
const siblingCopiesAvailable = siblingRuntimePaths.every((candidate) => existsSync(candidate));

test('local sibling runtime copies remain byte-identical', {
    skip: !siblingCopiesAvailable,
}, () => {
    assert.deepEqual(
        readFileSync(siblingRuntimePaths[0]),
        readFileSync(siblingRuntimePaths[1]),
    );
});
