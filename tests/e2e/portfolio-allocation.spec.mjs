/* Code version: v1.0.0 */

import {expect, test} from "@playwright/test";

test("previews By shares allocation before the server round-trip", async ({page}) => {
    await page.goto(
        "/workspaces/portfolio"
        + "?ticker=QQQ&ticker=AAPL&allocation=shares&shares=1&shares=1&period=1y",
    );
    await expect(page.locator("#portfolio_donut_start")).toBeVisible();
    await expect(page.locator(".portfolio-share-input").first()).toHaveValue("1");

    const preview = await page.evaluate(() => {
        const donut = document.getElementById("portfolio_donut_start");
        const sharesInput = document.querySelector(".portfolio-share-input");
        if (!(donut instanceof HTMLElement) || !(sharesInput instanceof HTMLInputElement)) {
            return null;
        }
        let previewDetail = null;
        window.addEventListener("worthward:portfolio-preview", (event) => {
            previewDetail = event.detail;
        }, {once: true});
        const before = donut.style.getPropertyValue("--portfolio-donut-fill");
        sharesInput.value = "4";
        sharesInput.dispatchEvent(new Event("input", {bubbles: true}));
        const after = donut.style.getPropertyValue("--portfolio-donut-fill");
        return {before, after, previewDetail};
    });

    expect(preview).not.toBeNull();
    expect(preview.after).not.toBe(preview.before);
    expect(preview.previewDetail).toEqual(expect.objectContaining({
        allocation: "shares",
        entries: expect.arrayContaining([
            expect.objectContaining({ticker: "QQQ", shares: 4}),
            expect.objectContaining({ticker: "AAPL", shares: 1}),
        ]),
    }));
});
