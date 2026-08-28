/* Code version: v1.3.0 */
import fs from 'node:fs';
import {defineConfig, devices} from '@playwright/test';

function requireE2ELock() {
    const lockFile = process.env.ANTIGRAVITY_E2E_LOCK_FILE;
    const lockRoot = process.env.ANTIGRAVITY_E2E_LOCK_ROOT;
    const lockToken = process.env.ANTIGRAVITY_E2E_LOCK_TOKEN;
    if (!lockFile || !lockRoot || !lockToken) {
        throw new Error(
            'Playwright must run through ./scripts/test_e2e.sh so it can own the isolated runtime.',
        );
    }

    let owner;
    try {
        owner = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    } catch {
        throw new Error('The inherited Playwright E2E lock is not readable.');
    }
    const currentRoot = fs.realpathSync(process.cwd());
    if (fs.realpathSync(lockRoot) !== currentRoot
        || fs.realpathSync(owner.root) !== currentRoot
        || owner.token !== lockToken) {
        throw new Error('The inherited Playwright E2E lock does not match this repository.');
    }
}

requireE2ELock();

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false,
    forbidOnly: true,
    retries: 0,
    workers: 1,
    reporter: [['list']],
    use: {
        baseURL: 'http://127.0.0.1:8699',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        {name: 'chromium', use: {...devices['Desktop Chrome']}},
    ],
    webServer: {
        command: './scripts/run_e2e_app.sh',
        url: 'http://127.0.0.1:8699/settings/about',
        reuseExistingServer: false,
        timeout: 120_000,
    },
});
