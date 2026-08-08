import baseConfig from './playwright.config.mjs';

export default {
    ...baseConfig,
    webServer: {
        ...baseConfig.webServer,
        reuseExistingServer: true,
    },
};
