/* Tests for shared fixed-chunk pagination. Code version: v1.3.0 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    INVESTMENT_HISTORY_PAGINATION_CHUNK_SIZE,
    INVESTMENT_PAGINATION_MODULE_VERSION,
    buildInvestmentHistoryPagination,
} from '../app/web/static/assets/js/investment/pagination.js';
import {
    buildLocalStorePagination,
    renderLocalStorePaginationItem,
} from '../app/web/static/assets/js/local-store-pagination.js';

function summarizeItems(items) {
    return items.map((item) => {
        if (item.kind === 'previous') return '<';
        if (item.kind === 'next') return '>';
        if (item.kind === 'ellipsis') return '...';
        return String(item.page);
    });
}

test('uses an immutable five-page chunk size', () => {
    assert.match(INVESTMENT_PAGINATION_MODULE_VERSION, /^v\d+\.\d+\.\d+$/);
    assert.equal(INVESTMENT_HISTORY_PAGINATION_CHUNK_SIZE, 5);
});

test('returns no controls when only one page exists', () => {
    const state = buildInvestmentHistoryPagination(1, 1);

    assert.equal(state.shouldRender, false);
    assert.equal(state.isCompact, false);
    assert.deepEqual(state.items, []);
});

test('renders every page without ellipses or arrows when the total is at most five', () => {
    const state = buildInvestmentHistoryPagination(3, 2);

    assert.deepEqual(summarizeItems(state.items), ['1', '2', '3']);
    assert.equal(state.startPage, 1);
    assert.equal(state.endPage, 3);
    assert.equal(state.shouldRender, true);
    assert.equal(state.isCompact, true);
    assert.equal(state.items.find((item) => item.isActive)?.page, 2);
});

test('renders the first fixed chunk with only the trailing boundary controls', () => {
    const state = buildInvestmentHistoryPagination(109, 3);

    assert.deepEqual(
        summarizeItems(state.items),
        ['1', '2', '3', '4', '5', '...', '109', '>'],
    );
    assert.equal(state.startPage, 1);
    assert.equal(state.endPage, 5);
    assert.equal(state.items.at(-1).page, 6);
});

test('renders fixed middle chunks instead of a rolling centered window', () => {
    const pageSixtyTwo = buildInvestmentHistoryPagination(109, 62);
    const pageSeventyEight = buildInvestmentHistoryPagination(109, 78);

    assert.deepEqual(
        summarizeItems(pageSixtyTwo.items),
        ['<', '1', '...', '61', '62', '63', '64', '65', '...', '109', '>'],
    );
    assert.equal(pageSixtyTwo.items[0].page, 60);
    assert.equal(pageSixtyTwo.items.at(-1).page, 66);
    assert.deepEqual(
        summarizeItems(pageSeventyEight.items),
        ['<', '1', '...', '76', '77', '78', '79', '80', '...', '109', '>'],
    );
});

test('renders the final boundary-aligned chunk without trailing duplicates', () => {
    const state = buildInvestmentHistoryPagination(109, 107);

    assert.deepEqual(
        summarizeItems(state.items),
        ['<', '1', '...', '106', '107', '108', '109'],
    );
    assert.equal(state.startPage, 106);
    assert.equal(state.endPage, 109);
    assert.equal(state.items[0].page, 105);
});

test('moves between adjacent chunks and selects the destination boundary page', () => {
    const pageFour = buildInvestmentHistoryPagination(51, 4);
    const pageSix = buildInvestmentHistoryPagination(51, 6);
    const pageEleven = buildInvestmentHistoryPagination(51, 11);

    assert.equal(pageFour.items.at(-1).kind, 'next');
    assert.equal(pageFour.items.at(-1).page, 6);
    assert.equal(pageSix.items[0].kind, 'previous');
    assert.equal(pageSix.items[0].page, 5);
    assert.equal(pageSix.items.at(-1).kind, 'next');
    assert.equal(pageSix.items.at(-1).page, 11);
    assert.equal(pageEleven.items[0].kind, 'previous');
    assert.equal(pageEleven.items[0].page, 10);
});

test('keeps the Investment compatibility builder identical to the shared builder', () => {
    for (const [totalPages, currentPage] of [
        [1, 1],
        [3, 2],
        [51, 1],
        [51, 6],
        [51, 51],
    ]) {
        assert.deepEqual(
            buildInvestmentHistoryPagination(totalPages, currentPage),
            buildLocalStorePagination(totalPages, currentPage),
        );
    }
});

test('renders server-backed anchors without changing the canonical control contract', () => {
    const anchorMarkup = renderLocalStorePaginationItem(
        {kind: 'page', page: 2, isActive: true},
        {
            additionalPageTargetAttribute: 'data-local-store-page',
            hrefForPage: (page) => `/settings/local-market-store?page=${page}&scope="all"`,
        },
    );
    const buttonMarkup = renderLocalStorePaginationItem({kind: 'previous', page: 5});

    assert.equal(
        anchorMarkup,
        '<a href="/settings/local-market-store?page=2&amp;scope=&quot;all&quot;" '
            + 'class="local-store-page-button is-active" data-pagination-target="2" '
            + 'data-local-store-page="2" data-pagination-current="1" aria-label="Page 2" '
            + 'aria-current="page">2</a>',
    );
    assert.equal(
        buttonMarkup,
        '<button type="button" class="local-store-page-button local-store-page-nav" '
            + 'data-pagination-target="5" data-pagination-current="0" aria-label="Previous page">'
            + '<span class="icon icon-page-prev" aria-hidden="true"></span></button>',
    );
});
