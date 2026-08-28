"""Disposable-browser verification for OpenAI Site tools registration.

Code version: v1.0.0
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from threading import Thread

import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, sync_playwright
from werkzeug.serving import BaseWSGIServer, make_server


REGISTER_TOOL_RECORDER = """
window.__registeredSiteTools = [];
Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: {
        async registerTool(definition) {
            window.__registeredSiteTools.push(definition);
        },
    },
});
"""
EXPECTED_TOOL_NAMES = [
    "get_site_capabilities",
    "get_page_context",
    "navigate_to_site_target",
]


@pytest.fixture(scope="module")
def agent_optimization_server_url() -> Iterator[str]:
    from app import create_app

    application = create_app()
    application.config.update(TESTING=True)
    server: BaseWSGIServer = make_server("127.0.0.1", 0, application, threaded=True)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.fixture(scope="module")
def agent_optimization_browser() -> Iterator[Browser]:
    with sync_playwright() as playwright:
        browser_type = playwright.chromium
        if Path(browser_type.executable_path).is_file():
            browser = browser_type.launch(headless=True)
        else:
            errors = []
            for channel in ("chrome", "msedge"):
                try:
                    browser = browser_type.launch(channel=channel, headless=True)
                    break
                except PlaywrightError as error:  # pragma: no cover - host inventory
                    errors.append(f"{channel}: {error}")
            else:  # pragma: no cover - host inventory
                raise AssertionError("No disposable Chromium browser is available. " + " | ".join(errors))
        try:
            yield browser
        finally:
            browser.close()


@pytest.mark.integration
@pytest.mark.slow
def test_site_tools_register_execute_and_navigate_in_a_disposable_browser(
    agent_optimization_browser: Browser,
    agent_optimization_server_url: str,
) -> None:
    context = agent_optimization_browser.new_context(viewport={"width": 1_280, "height": 900})
    page = context.new_page()
    page.add_init_script(REGISTER_TOOL_RECORDER)
    try:
        page.goto(f"{agent_optimization_server_url}/settings/about", wait_until="domcontentloaded")
        page.wait_for_function("window.__registeredSiteTools?.length === 3")
        assert page.evaluate(
            "window.__registeredSiteTools.map(definition => definition.name)"
        ) == EXPECTED_TOOL_NAMES

        page_context = page.evaluate(
            """async () => {
                const tool = window.__registeredSiteTools.find(
                    definition => definition.name === "get_page_context",
                );
                return tool.execute({});
            }"""
        )
        assert page_context["ok"] is True
        assert page_context["data"]["siteId"] == "antigravity"
        assert page_context["data"]["route"] == "/settings/about"
        assert page_context["data"]["matchingTarget"]["id"] == "settings"
        assert page_context["verification"]["contentFieldsRead"] == 0

        navigation_result = page.evaluate(
            """async () => {
                const tool = window.__registeredSiteTools.find(
                    definition => definition.name === "navigate_to_site_target",
                );
                return tool.execute({target: "ticker_comparison"});
            }"""
        )
        assert navigation_result["ok"] is True
        assert navigation_result["verification"]["sameOrigin"] is True
        assert navigation_result["effects"]["directPersistedDataMutation"] is False
        assert navigation_result["effects"]["pageLoadMayUseExistingDataFlows"] is True
        page.wait_for_url(f"{agent_optimization_server_url}/workspaces/compare")
        page.wait_for_function("window.__registeredSiteTools?.length === 3")
    finally:
        context.close()


@pytest.mark.integration
@pytest.mark.slow
def test_unsupported_browser_keeps_the_narrow_human_interface_intact(
    agent_optimization_browser: Browser,
    agent_optimization_server_url: str,
) -> None:
    context = agent_optimization_browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    page_errors: list[str] = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    try:
        page.goto(f"{agent_optimization_server_url}/settings/about", wait_until="domcontentloaded")
        status = page.evaluate("window.SHARED_AGENT_OPTIMIZATION.boot()")

        assert status["status"] == "unsupported"
        assert page.locator("#agent_optimization_manifest").count() == 1
        assert page.locator("#sidebar_toggle").is_visible()
        assert page.locator("#workspace_panel").is_visible()
        assert page_errors == []
    finally:
        context.close()
