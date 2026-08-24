/* Code version: v1.0.0 */
import {expect, test} from '@playwright/test';

const targetPaths = [
    '/html/body/main/div/section/section/section/div/section[1]/div[1]/div',
    '/html/body/main/div/section/section/section/div/section[2]/div[1]/button',
    '/html/body/main/div/section/section/section/div/section[4]/div[1]/div',
    '/html/body/main/div/section/section/section/div/section[5]/div[1]/div/div',
    '/html/body/main/div/section/section/section/div/section[9]/div[1]',
    '/html/body/main/div/section/section/section/div/section[13]/div[1]/div/div/div/div',
];

test('keeps Style tokens physical effects outside the workspace clip', async ({page}) => {
    await page.setViewportSize({width: 1_280, height: 720});
    await page.goto('/settings/style-tokens');

    await expect.poll(async () => Promise.all(
        targetPaths.map((path) => page.locator(`xpath=${path}`).count()),
    )).toEqual([1, 1, 1, 1, 1, 1]);

    const layout = await page.evaluate(() => {
        const workspace = document.querySelector('#settings_workspace_shell');
        const tokenShell = document.querySelector('[data-style-token-shell]');
        const list = document.querySelector('.style-token-list');
        const demo = document.querySelector('[data-style-token-card="chart-tooltip"] .style-token-demo');
        const modalShell = document.querySelector('[data-style-token-card="modal-dialog"] .style-token-modal-shell');
        if (!(workspace instanceof HTMLElement)
            || !(tokenShell instanceof HTMLElement)
            || !(list instanceof HTMLElement)
            || !(demo instanceof HTMLElement)
            || !(modalShell instanceof HTMLElement)) return null;

        const rectOf = (element) => {
            const rect = element.getBoundingClientRect();
            return {left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom};
        };
        const workspaceStyle = getComputedStyle(workspace);
        const tokenShellStyle = getComputedStyle(tokenShell);
        const listStyle = getComputedStyle(list);
        const modalShellStyle = getComputedStyle(modalShell);
        return {
            workspace: {
                overflowX: workspaceStyle.overflowX,
                overflowY: workspaceStyle.overflowY,
                rect: rectOf(workspace),
            },
            tokenShell: {
                overflowX: tokenShellStyle.overflowX,
                overflowY: tokenShellStyle.overflowY,
                rect: rectOf(tokenShell),
            },
            list: {
                overflowX: listStyle.overflowX,
                overflowY: listStyle.overflowY,
                rect: rectOf(list),
                scrollHeight: list.scrollHeight,
                clientHeight: list.clientHeight,
            },
            demo: rectOf(demo),
            modalShell: {
                overflowX: modalShellStyle.overflowX,
                overflowY: modalShellStyle.overflowY,
            },
            body: {scrollWidth: document.body.scrollWidth, clientWidth: document.body.clientWidth},
        };
    });

    expect(layout).not.toBeNull();
    expect(layout).toMatchObject({
        workspace: {overflowX: 'visible', overflowY: 'visible'},
        tokenShell: {overflowX: 'visible', overflowY: 'visible'},
        list: {overflowY: 'auto'},
        modalShell: {overflowX: 'visible', overflowY: 'visible'},
    });
    expect(layout.list.scrollHeight).toBeGreaterThan(layout.list.clientHeight);
    expect(layout.list.rect.left).toBeLessThan(layout.workspace.rect.left - 32);
    expect(layout.list.rect.right).toBeGreaterThan(layout.workspace.rect.right + 32);
    expect(layout.demo.left).toBeGreaterThanOrEqual(layout.list.rect.left + 32);
    expect(Math.abs(layout.demo.left - layout.tokenShell.rect.left)).toBeLessThanOrEqual(1);
    expect(layout.body.scrollWidth).toBe(layout.body.clientWidth);
});

test('keeps the same physical-effects contract at a narrow viewport', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/settings/style-tokens');

    const geometry = await page.evaluate(() => {
        const workspace = document.querySelector('#settings_workspace_shell');
        const list = document.querySelector('.style-token-list');
        const demo = document.querySelector('[data-style-token-card="chart-tooltip"] .style-token-demo');
        if (!(workspace instanceof HTMLElement)
            || !(list instanceof HTMLElement)
            || !(demo instanceof HTMLElement)) return null;
        const workspaceRect = workspace.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        const demoRect = demo.getBoundingClientRect();
        return {
            workspaceOverflow: getComputedStyle(workspace).overflow,
            listOverflowY: getComputedStyle(list).overflowY,
            listRect: {left: listRect.left, right: listRect.right},
            demoRect: {left: demoRect.left, right: demoRect.right},
            workspaceRect: {left: workspaceRect.left, right: workspaceRect.right},
            scrollable: list.scrollHeight > list.clientHeight,
            bodyScrollWidth: document.body.scrollWidth,
            bodyClientWidth: document.body.clientWidth,
        };
    });

    expect(geometry).toMatchObject({
        workspaceOverflow: 'visible',
        listOverflowY: 'auto',
        scrollable: true,
        bodyScrollWidth: 390,
        bodyClientWidth: 390,
    });
    expect(geometry.listRect.left).toBeLessThan(geometry.workspaceRect.left - 32);
    expect(geometry.demoRect.left).toBeGreaterThanOrEqual(geometry.listRect.left + 32);
    expect(Math.abs(geometry.demoRect.left - geometry.workspaceRect.left)).toBeLessThanOrEqual(1);
});
