/* Tests for fixed-chunk Investment pagination. Code version: v1.1.0 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    INVESTMENT_HISTORY_PAGINATION_CHUNK_SIZE,
    INVESTMENT_PAGINATION_MODULE_VERSION,
    buildInvestmentHistoryPagination,
} from '../app/web/static/assets/js/investment/pagination.js';

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
    assert.equal(state.items.at(-1).page, 4);
});

test('renders fixed middle chunks instead of a rolling centered window', () => {
    const pageSixtyTwo = buildInvestmentHistoryPagination(109, 62);
    const pageSeventyEight = buildInvestmentHistoryPagination(109, 78);

    assert.deepEqual(
        summarizeItems(pageSixtyTwo.items),
        ['<', '1', '...', '61', '62', '63', '64', '65', '...', '109', '>'],
    );
    assert.equal(pageSixtyTwo.items[0].page, 61);
    assert.equal(pageSixtyTwo.items.at(-1).page, 63);
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
    assert.equal(state.items[0].page, 106);
});

test('steps across chunk boundaries by one page in either direction', () => {
    const endOfFirstChunk = buildInvestmentHistoryPagination(109, 5);
    const startOfSecondChunk = buildInvestmentHistoryPagination(109, 6);

    assert.equal(endOfFirstChunk.items.at(-1).kind, 'next');
    assert.equal(endOfFirstChunk.items.at(-1).page, 6);
    assert.equal(startOfSecondChunk.items[0].kind, 'previous');
    assert.equal(startOfSecondChunk.items[0].page, 5);
});
