/**
 * Investment pagination compatibility exports.
 *
 * Code version: v1.4.0
 * - Added: Investment history inherits the shared hidden-page range picker.
 */

import {
    LOCAL_STORE_PAGINATION_CHUNK_SIZE,
    LOCAL_STORE_PAGINATION_MODULE_VERSION,
    animateLocalStorePaginationIndicator,
    bindLocalStorePagination,
    captureLocalStorePaginationAnimation,
    buildLocalStorePagination,
    ensureLocalStorePaginationIndicator,
    getLocalStorePaginationMotionDurationMs,
    positionLocalStorePaginationIndicator,
    renderLocalStorePagination,
    setLocalStorePaginationActivePage,
} from '../local-store-pagination.js?v=local-store-pagination-v1.2.0';

export const INVESTMENT_PAGINATION_MODULE_VERSION = 'v1.4.0';
export const INVESTMENT_HISTORY_PAGINATION_CHUNK_SIZE = LOCAL_STORE_PAGINATION_CHUNK_SIZE;

export {
    LOCAL_STORE_PAGINATION_MODULE_VERSION,
    animateLocalStorePaginationIndicator,
    bindLocalStorePagination,
    captureLocalStorePaginationAnimation,
    buildLocalStorePagination as buildInvestmentHistoryPagination,
    ensureLocalStorePaginationIndicator,
    getLocalStorePaginationMotionDurationMs,
    positionLocalStorePaginationIndicator,
    renderLocalStorePagination,
    setLocalStorePaginationActivePage,
};
