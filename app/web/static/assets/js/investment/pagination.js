/**
 * Fixed-chunk pagination helpers for Investment transaction history.
 *
 * Code version: v1.2.0
 * - Changed: Navigation arrows now move between adjacent five-page chunks instead of stepping one page.
 */

export const INVESTMENT_PAGINATION_MODULE_VERSION = 'v1.2.0';
export const INVESTMENT_HISTORY_PAGINATION_CHUNK_SIZE = 5;

function normalizePositiveInteger(value, fallback = 1) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return fallback;
    return Math.max(1, Math.trunc(numericValue));
}

function createPageItem(page, currentPage) {
    return {
        kind: 'page',
        page,
        isActive: page === currentPage,
    };
}

/**
 * Build a stable five-page bucket with navigation arrows targeting adjacent chunks.
 */
export function buildInvestmentHistoryPagination(totalPages = 1, currentPage = 1) {
    const normalizedTotalPages = normalizePositiveInteger(totalPages);
    const normalizedCurrentPage = Math.min(
        normalizedTotalPages,
        normalizePositiveInteger(currentPage),
    );
    const startPage = Math.floor(
        (normalizedCurrentPage - 1) / INVESTMENT_HISTORY_PAGINATION_CHUNK_SIZE,
    ) * INVESTMENT_HISTORY_PAGINATION_CHUNK_SIZE + 1;
    const endPage = Math.min(
        startPage + INVESTMENT_HISTORY_PAGINATION_CHUNK_SIZE - 1,
        normalizedTotalPages,
    );
    const isFirstChunk = startPage === 1;
    const isLastChunk = endPage === normalizedTotalPages;
    const shouldRender = normalizedTotalPages > 1;
    const isCompact = shouldRender
        && normalizedTotalPages <= INVESTMENT_HISTORY_PAGINATION_CHUNK_SIZE;
    const items = [];

    if (!shouldRender) {
        return {
            totalPages: normalizedTotalPages,
            currentPage: normalizedCurrentPage,
            startPage,
            endPage,
            shouldRender,
            isCompact,
            items,
        };
    }

    if (isCompact) {
        for (let page = 1; page <= normalizedTotalPages; page += 1) {
            items.push(createPageItem(page, normalizedCurrentPage));
        }
    } else {
        if (!isFirstChunk) {
            items.push({ kind: 'previous', page: startPage - 1 });
            items.push(createPageItem(1, normalizedCurrentPage));
            items.push({ kind: 'ellipsis', position: 'leading' });
        }

        for (let page = startPage; page <= endPage; page += 1) {
            items.push(createPageItem(page, normalizedCurrentPage));
        }

        if (!isLastChunk) {
            items.push({ kind: 'ellipsis', position: 'trailing' });
            items.push(createPageItem(normalizedTotalPages, normalizedCurrentPage));
            items.push({ kind: 'next', page: endPage + 1 });
        }
    }

    return {
        totalPages: normalizedTotalPages,
        currentPage: normalizedCurrentPage,
        startPage,
        endPage,
        shouldRender,
        isCompact,
        items,
    };
}
