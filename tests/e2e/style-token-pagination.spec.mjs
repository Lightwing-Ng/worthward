/* Code version: v1.3.1 */
import {expect, test} from '@playwright/test';

const paginationSelector = '#style_token_pagination_demo';
const paginationMetaXPath = '/html/body/main/div/section/section/section/div/section[4]/div[2]';
const scrollableTableDemoSelector = '[data-style-token-card="scrollable-data-table"] .style-token-table-demo-shell';

test('keeps the Style tokens pagination demo circular and makes both hidden ranges interactive', async ({page}) => {
    await page.goto('/settings/style-tokens');

    const pagination = page.locator(paginationSelector);
    const leadingRange = pagination.locator('[data-pagination-ellipsis="leading"]');
    const trailingRange = pagination.locator('[data-pagination-ellipsis="trailing"]');
    const previousPage = pagination.locator('button.local-store-page-nav[aria-label="Previous page"]');
    const nextPage = pagination.locator('button.local-store-page-nav[aria-label="Next page"]');

    await expect(pagination).toHaveCount(1);
    await expect(previousPage).toHaveCount(1);
    await expect(previousPage.locator('.icon-page-prev')).toHaveCount(1);
    await expect(nextPage).toHaveCount(1);
    await expect(nextPage.locator('.icon-page-next')).toHaveCount(1);
    await expect(leadingRange).toHaveClass(/local-store-pagination-range-picker/);
    await expect(trailingRange).toHaveClass(/local-store-pagination-range-picker/);
    await expect(leadingRange.locator('[data-pagination-range-trigger]')).toHaveCount(1);
    await expect(trailingRange.locator('[data-pagination-range-trigger]')).toHaveCount(1);

    const geometry = await pagination.evaluate((nav) => {
        const active = nav.querySelector('.local-store-page-button.is-active');
        const indicator = nav.querySelector('.local-store-pagination-indicator');
        const activeRect = active.getBoundingClientRect();
        const indicatorRect = indicator.getBoundingClientRect();
        return {
            active: {
                width: activeRect.width,
                height: activeRect.height,
                borderRadius: getComputedStyle(active).borderRadius,
            },
            indicator: {
                width: indicatorRect.width,
                height: indicatorRect.height,
                borderRadius: getComputedStyle(indicator).borderRadius,
            },
            delta: {
                x: indicatorRect.x - activeRect.x,
                y: indicatorRect.y - activeRect.y,
                width: indicatorRect.width - activeRect.width,
                height: indicatorRect.height - activeRect.height,
            },
        };
    });
    expect(geometry.active.width).toBe(30);
    expect(geometry.active.height).toBe(30);
    expect(geometry.indicator.width).toBe(30);
    expect(geometry.indicator.height).toBe(30);
    expect(geometry.active.borderRadius).toBe('50%');
    expect(geometry.indicator.borderRadius).toBe('50%');
    expect(Math.abs(geometry.delta.x)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(geometry.delta.y)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(geometry.delta.width)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(geometry.delta.height)).toBeLessThanOrEqual(0.01);

    await leadingRange.hover();
    await expect(leadingRange.locator('[data-pagination-range-menu]')).toBeVisible();
    await leadingRange.locator('[data-pagination-range-trigger]').click();
    await leadingRange.getByRole('menuitem', {name: 'Pages 6 through 10', exact: true}).click();
    await expect(pagination).toHaveAttribute('data-pagination-current-page', '6');
    await expect(pagination.locator('.local-store-page-button.is-active')).toHaveText('6');

    await trailingRange.hover();
    await expect(trailingRange.locator('[data-pagination-range-menu]')).toBeVisible();
    await trailingRange.locator('[data-pagination-range-trigger]').click();
    await trailingRange.getByRole('menuitem', {name: 'Pages 31 through 35', exact: true}).click();
    await expect(pagination).toHaveAttribute('data-pagination-current-page', '31');
    await expect(pagination.locator('.local-store-page-button.is-active')).toHaveText('31');
    await expect(pagination.locator('.local-store-pagination-range-picker.is-open')).toHaveCount(0);
});

test('keeps the scrollable data table aligned after moving to page two', async ({page}) => {
    await page.goto('/settings/style-tokens');

    const demo = page.locator(scrollableTableDemoSelector);
    const nextPage = demo.locator('[data-style-token-table-pagination] button[data-pagination-target="2"]');

    await expect(demo).toHaveCount(1);
    await expect(nextPage).toHaveAttribute('data-pagination-target', '2');

    await nextPage.click();
    await expect(demo.locator('[data-style-token-table-pagination]'))
        .toHaveAttribute('data-pagination-current-page', '2');

    const geometry = await demo.evaluate((node) => {
        const shell = node.querySelector('.style-token-table-demo');
        const header = node.querySelector('table[data-table-header]');
        const scroll = node.querySelector('[data-table-scroll]');
        const sectionRect = node.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        return {
            section: {width: sectionRect.width, height: sectionRect.height},
            header: {width: headerRect.width, height: headerRect.height},
            shellStyle: shell.getAttribute('style') || '',
            pageTwoRowVisible: [...node.querySelectorAll('[data-style-token-table-demo-row]')]
                .filter((row) => !row.hidden)
                .map((row) => row.cells[0]?.textContent?.trim()),
            scrollWidthDelta: scroll.scrollWidth - scroll.clientWidth,
        };
    });

    expect(geometry.section.width).toBeLessThanOrEqual(520);
    expect(geometry.section.height).toBeGreaterThanOrEqual(170);
    expect(geometry.header.width).toBeLessThanOrEqual(520);
    expect(geometry.header.height).toBeLessThan(100);
    expect(geometry.shellStyle).not.toContain('--scrollable-data-table-scrollbar-width: 720px');
    expect(geometry.shellStyle).not.toContain('--scrollable-data-table-header-height: 404px');
    expect(geometry.pageTwoRowVisible).toEqual(['6', '5', '4', '3', '2', '1']);
    expect(geometry.scrollWidthDelta).toBeLessThan(40);
});

test('shows the shared Frosted glass material reference in the pagination metadata', async ({page}) => {
    await page.goto('/settings/style-tokens');

    const metadata = page.locator(`xpath=${paginationMetaXPath}`);
    const materialLink = metadata.locator('a[data-style-token-material-link]');

    await expect(materialLink).toHaveCount(1);
    await expect(materialLink).toHaveText('Frosted glass');
    await expect(materialLink).toHaveAttribute('href', /\/settings\/material-tokens#frosted-glass$/);
});

test('reuses the shared Frosted glass material for modal dialog and banner message', async ({page}) => {
    await page.goto('/settings/style-tokens');

    for (const cardId of ['modal-dialog', 'modal-dialog-banner-message']) {
        const card = page.locator(`[data-style-token-card="${cardId}"]`);
        const materialLink = card.locator('a[data-style-token-material-link]');

        await expect(materialLink).toHaveCount(1);
        await expect(materialLink).toHaveText('Frosted glass');
        await expect(materialLink).toHaveAttribute('href', /\/settings\/material-tokens#frosted-glass$/);
    }

    const material = await page.evaluate(() => {
        const elements = [
            document.querySelector('[data-style-token-card="modal-dialog"] .workspace-modal-dialog'),
            document.querySelector('[data-style-token-card="modal-dialog-banner-message"] .notice-floating-banner'),
        ];
        if (elements.some((element) => !(element instanceof HTMLElement))) return null;

        const probe = document.createElement('div');
        probe.style.cssText = [
            'position: fixed',
            'inline-size: 1px',
            'block-size: 1px',
            'background: var(--frosted-glass-background)',
            'border: var(--frosted-glass-border)',
            'box-shadow: var(--frosted-glass-shadow)',
            'backdrop-filter: var(--frosted-glass-blur)',
            '-webkit-backdrop-filter: var(--frosted-glass-blur)',
        ].join(';');
        document.body.append(probe);
        const expectedStyle = getComputedStyle(probe);
        const expected = {
            background: expectedStyle.backgroundColor,
            backgroundImage: expectedStyle.backgroundImage,
            border: expectedStyle.border,
            boxShadow: expectedStyle.boxShadow,
            backdropFilter: expectedStyle.backdropFilter || expectedStyle.webkitBackdropFilter,
        };
        const actual = elements.map((element) => {
            const style = getComputedStyle(element);
            return {
                background: style.backgroundColor,
                backgroundImage: style.backgroundImage,
                border: style.border,
                boxShadow: style.boxShadow,
                backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
            };
        });
        probe.remove();
        return {actual, expected};
    });

    expect(material).not.toBeNull();
    expect(material.actual).toEqual([material.expected, material.expected]);
});
