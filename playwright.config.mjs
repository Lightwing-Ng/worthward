/* Code version: v1.2.0 */
import {defineConfig, devices} from '@playwright/test';

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
