/**
 * Shared Local store pagination primitives.
 *
 * Code version: v1.1.0
 * - Added: Fixed five-page chunks, canonical button markup, and the shared
 *   active-indicator motion used by every local pagination surface.
 * - Added: Link rendering keeps server-backed pagination on the same builder
 *   and control contract as client-only pagination.
 */

const LOCAL_STORE_PAGINATION_MODULE_VERSION = 'v1.1.0';
const LOCAL_STORE_PAGINATION_CHUNK_SIZE = 5;
const LOCAL_STORE_PAGINATION_DEFAULT_PAGE_SIZE = 10;

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
 * Build a stable five-page bucket with adjacent-chunk navigation controls.
 */
export function buildLocalStorePagination(totalPages = 1, currentPage = 1) {
    const normalizedTotalPages = normalizePositiveInteger(totalPages);
    const normalizedCurrentPage = Math.min(
        normalizedTotalPages,
        normalizePositiveInteger(currentPage),
    );
    const startPage = Math.floor(
        (normalizedCurrentPage - 1) / LOCAL_STORE_PAGINATION_CHUNK_SIZE,
    ) * LOCAL_STORE_PAGINATION_CHUNK_SIZE + 1;
    const endPage = Math.min(
        startPage + LOCAL_STORE_PAGINATION_CHUNK_SIZE - 1,
        normalizedTotalPages,
    );
    const isFirstChunk = startPage === 1;
    const isLastChunk = endPage === normalizedTotalPages;
    const shouldRender = normalizedTotalPages > 1;
    const isCompact = shouldRender
        && normalizedTotalPages <= LOCAL_STORE_PAGINATION_CHUNK_SIZE;
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
            items.push({kind: 'previous', page: startPage - 1});
            items.push(createPageItem(1, normalizedCurrentPage));
            items.push({kind: 'ellipsis', position: 'leading'});
        }

        for (let page = startPage; page <= endPage; page += 1) {
            items.push(createPageItem(page, normalizedCurrentPage));
        }

        if (!isLastChunk) {
            items.push({kind: 'ellipsis', position: 'trailing'});
            items.push(createPageItem(normalizedTotalPages, normalizedCurrentPage));
            items.push({kind: 'next', page: endPage + 1});
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

function buildPageTargetAttributes(page, {
    pageTargetAttribute = 'data-pagination-target',
    additionalPageTargetAttribute = '',
} = {}) {
    const attributes = [`${pageTargetAttribute}="${page}"`];
    if (additionalPageTargetAttribute) {
        attributes.push(`${additionalPageTargetAttribute}="${page}"`);
    }
    return attributes.join(' ');
}

function escapeHtmlAttribute(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function buildPaginationControlMarkup({
    className,
    content,
    href,
    attributes,
}) {
    if (href) {
        return `<a href="${escapeHtmlAttribute(href)}" class="${className}" ${attributes}>${content}</a>`;
    }
    return `<button type="button" class="${className}" ${attributes}>${content}</button>`;
}

export function renderLocalStorePaginationItem(item, options = {}) {
    if (item?.kind === 'ellipsis') {
        return '<span class="local-store-page-ellipsis" aria-hidden="true" data-pagination-ellipsis="'
            + `${item.position}"><span class="local-store-page-ellipsis-dots"></span></span>`;
    }

    const targetPage = Number(item?.page);
    if (!Number.isFinite(targetPage) || targetPage <= 0) return '';
    const targetAttributes = buildPageTargetAttributes(targetPage, options);
    const href = typeof options.hrefForPage === 'function'
        ? String(options.hrefForPage(targetPage) || '')
        : '';
    if (item.kind === 'previous' || item.kind === 'next') {
        const isPrevious = item.kind === 'previous';
        const direction = isPrevious ? 'Previous' : 'Next';
        const iconClass = isPrevious ? 'icon-page-prev' : 'icon-page-next';
        return buildPaginationControlMarkup({
            className: 'local-store-page-button local-store-page-nav',
            content: `<span class="icon ${iconClass}" aria-hidden="true"></span>`,
            href,
            attributes: `${targetAttributes} data-pagination-current="0" aria-label="${direction} page"`,
        });
    }

    const isActive = Boolean(item.isActive);
    return buildPaginationControlMarkup({
        className: `local-store-page-button${isActive ? ' is-active' : ''}`,
        content: String(targetPage),
        href,
        attributes: `${targetAttributes} data-pagination-current="${isActive ? '1' : '0'}" aria-label="Page ${targetPage}"${isActive ? ' aria-current="page"' : ''}`,
    });
}

export function ensureLocalStorePaginationIndicator(pagination) {
    if (!pagination) return null;
    let indicator = pagination.querySelector('.local-store-pagination-indicator');
    if (!indicator) {
        indicator = document.createElement('span');
        indicator.className = 'local-store-pagination-indicator';
        indicator.setAttribute('aria-hidden', 'true');
        pagination.prepend(indicator);
    }
    return indicator;
}

export function positionLocalStorePaginationIndicator(pagination, target, {immediate = false} = {}) {
    if (!pagination || !target) return;
    const indicator = ensureLocalStorePaginationIndicator(pagination);
    if (!indicator) return;
    const paginationRect = pagination.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const x = targetRect.left - paginationRect.left - pagination.clientLeft;
    const y = targetRect.top - paginationRect.top - pagination.clientTop;
    if (immediate) indicator.style.transition = 'none';
    indicator.style.width = `${targetRect.width}px`;
    indicator.style.height = `${targetRect.height}px`;
    indicator.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    pagination.classList.add('is-animated');
    if (immediate) {
        void indicator.offsetWidth;
        indicator.style.removeProperty('transition');
    }
}

function getPaginationTargetPage(button, pageTargetAttribute = 'data-pagination-target') {
    const rawPage = button?.getAttribute(pageTargetAttribute);
    const page = Number(rawPage);
    return Number.isFinite(page) && page > 0 ? page : 0;
}

function findPaginationTarget(pagination, targetPage, pageTargetAttribute = 'data-pagination-target') {
    const normalizedTargetPage = Number(targetPage);
    if (!Number.isFinite(normalizedTargetPage) || normalizedTargetPage <= 0) return null;
    return Array.from(pagination.querySelectorAll('.local-store-page-button'))
        .find((button) => (
            !button.classList.contains('local-store-page-nav')
            && !button.classList.contains('local-store-page-placeholder')
            && getPaginationTargetPage(button, pageTargetAttribute) === normalizedTargetPage
        )) || null;
}

function clearPaginationAnimationTimer(pagination) {
    const timer = pagination?.__localStorePaginationAnimationTimer;
    if (timer) window.clearTimeout(timer);
    if (pagination) delete pagination.__localStorePaginationAnimationTimer;
}

export function getLocalStorePaginationMotionDurationMs(pagination, fallback = 500) {
    if (!pagination) return fallback;
    const rawDuration = window.getComputedStyle(pagination)
        .getPropertyValue('--local-store-pagination-motion-duration')
        .trim();
    const parsedDuration = Number.parseFloat(rawDuration);
    if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) return fallback;
    return rawDuration.endsWith('ms') ? parsedDuration : parsedDuration * 1000;
}

export function captureLocalStorePaginationAnimation(
    pagination,
    targetPage,
    {pageTargetAttribute = 'data-pagination-target'} = {},
) {
    if (!pagination || pagination.hidden) return null;
    const current = pagination.querySelector('.local-store-page-button.is-active')
        || pagination.querySelector('.local-store-page-button[data-pagination-current="1"]');
    if (!current) return null;
    const currentRect = current.getBoundingClientRect();
    return {
        fromRect: {
            left: currentRect.left,
            top: currentRect.top,
            width: currentRect.width,
            height: currentRect.height,
        },
        targetPage: Number(targetPage),
        pageTargetAttribute,
    };
}

export function setLocalStorePaginationActivePage(
    pagination,
    targetPage,
    {pageTargetAttribute = 'data-pagination-target'} = {},
) {
    if (!pagination) return null;
    const target = findPaginationTarget(pagination, targetPage, pageTargetAttribute);
    if (!target) return null;
    Array.from(pagination.querySelectorAll('.local-store-page-button'))
        .forEach((button) => {
            const isTarget = button === target;
            button.classList.toggle('is-active', isTarget);
            button.dataset.paginationCurrent = isTarget ? '1' : '0';
            if (isTarget) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        });
    pagination.classList.add('is-animated');
    return target;
}

export function animateLocalStorePaginationIndicator(
    pagination,
    animationState,
    {pageTargetAttribute = animationState?.pageTargetAttribute || 'data-pagination-target'} = {},
) {
    if (!pagination || pagination.hidden) {
        positionLocalStorePaginationIndicator(
            pagination,
            pagination?.querySelector('.local-store-page-button.is-active'),
            {immediate: true},
        );
        return;
    }
    const fromRect = animationState?.fromRect;
    const target = findPaginationTarget(pagination, animationState?.targetPage, pageTargetAttribute);
    if (!target || !fromRect) {
        positionLocalStorePaginationIndicator(
            pagination,
            pagination.querySelector('.local-store-page-button.is-active'),
            {immediate: true},
        );
        return;
    }

    const indicator = ensureLocalStorePaginationIndicator(pagination);
    if (!indicator) return;
    const paginationRect = pagination.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const fromX = fromRect.left - paginationRect.left - pagination.clientLeft;
    const fromY = fromRect.top - paginationRect.top - pagination.clientTop;
    const targetX = targetRect.left - paginationRect.left - pagination.clientLeft;
    const targetY = targetRect.top - paginationRect.top - pagination.clientTop;
    clearPaginationAnimationTimer(pagination);
    pagination.classList.add('is-animated', 'is-animating');
    indicator.style.transition = 'none';
    indicator.style.width = `${fromRect.width}px`;
    indicator.style.height = `${fromRect.height}px`;
    indicator.style.transform = `translate3d(${fromX}px, ${fromY}px, 0)`;
    void indicator.offsetWidth;
    indicator.style.removeProperty('transition');
    window.requestAnimationFrame(() => {
        indicator.style.width = `${targetRect.width}px`;
        indicator.style.height = `${targetRect.height}px`;
        indicator.style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`;
    });
    pagination.__localStorePaginationAnimationTimer = window.setTimeout(() => {
        delete pagination.__localStorePaginationAnimationTimer;
        pagination.classList.remove('is-animating');
        positionLocalStorePaginationIndicator(pagination, target, {immediate: true});
    }, getLocalStorePaginationMotionDurationMs(pagination));
}

export function renderLocalStorePagination(pagination, state, options = {}) {
    if (!pagination) return;
    clearPaginationAnimationTimer(pagination);
    pagination.classList.remove('is-animated', 'is-animating');
    if (!state?.shouldRender) {
        pagination.innerHTML = '';
        pagination.style.removeProperty('--local-store-pagination-slots');
        delete pagination.dataset.paginationPageCount;
        delete pagination.dataset.paginationCurrentPage;
        delete pagination.dataset.paginationCompact;
        return;
    }
    const items = Array.isArray(state.items) ? state.items : [];
    pagination.style.setProperty('--local-store-pagination-slots', String(items.length));
    pagination.dataset.paginationPageCount = String(state.totalPages);
    pagination.dataset.paginationCurrentPage = String(state.currentPage);
    pagination.dataset.paginationCompact = state.isCompact ? '1' : '0';
    pagination.innerHTML = `<span class="local-store-pagination-indicator" aria-hidden="true"></span>${items.map((item) => renderLocalStorePaginationItem(item, options)).join('')}`;
    positionLocalStorePaginationIndicator(
        pagination,
        pagination.querySelector('.local-store-page-button.is-active'),
        {immediate: true},
    );
}

export function bindLocalStorePagination(
    pagination,
    onNavigate,
    {pageTargetAttribute = 'data-pagination-target'} = {},
) {
    if (!pagination || pagination.dataset.paginationBound === '1') return;
    pagination.dataset.paginationBound = '1';
    pagination.addEventListener('click', (event) => {
        const button = event.target?.closest?.(`[${pageTargetAttribute}]`);
        if (!button || button.classList.contains('local-store-page-placeholder')) return;
        const targetPage = getPaginationTargetPage(button, pageTargetAttribute);
        if (!targetPage || button.getAttribute('aria-current') === 'page') return;
        const animationState = captureLocalStorePaginationAnimation(
            pagination,
            targetPage,
            {pageTargetAttribute},
        );
        if (button instanceof HTMLAnchorElement) event.preventDefault();
        onNavigate?.(targetPage, {button, event, animationState});
    });
}

export function syncLocalStorePaginationActivePage(
    pagination,
    targetPage,
    {pageTargetAttribute = 'data-pagination-target'} = {},
) {
    const target = setLocalStorePaginationActivePage(pagination, targetPage, {pageTargetAttribute});
    if (!target) {
        window.requestAnimationFrame(() => {
            positionLocalStorePaginationIndicator(
                pagination,
                pagination?.querySelector('.local-store-page-button.is-active'),
                {immediate: true},
            );
        });
        return;
    }
    window.requestAnimationFrame(() => {
        positionLocalStorePaginationIndicator(pagination, target, {immediate: true});
    });
}

export {
    LOCAL_STORE_PAGINATION_CHUNK_SIZE,
    LOCAL_STORE_PAGINATION_DEFAULT_PAGE_SIZE,
    LOCAL_STORE_PAGINATION_MODULE_VERSION,
};

if (typeof window !== 'undefined') {
    window.ANTIGRAVITY_LOCAL_STORE_PAGINATION = Object.freeze({
        LOCAL_STORE_PAGINATION_CHUNK_SIZE,
        LOCAL_STORE_PAGINATION_DEFAULT_PAGE_SIZE,
        LOCAL_STORE_PAGINATION_MODULE_VERSION,
        animateLocalStorePaginationIndicator,
        bindLocalStorePagination,
        buildLocalStorePagination,
        captureLocalStorePaginationAnimation,
        ensureLocalStorePaginationIndicator,
        getLocalStorePaginationMotionDurationMs,
        positionLocalStorePaginationIndicator,
        renderLocalStorePagination,
        setLocalStorePaginationActivePage,
        syncLocalStorePaginationActivePage,
    });
    window.dispatchEvent(new Event('antigravity:local-store-pagination-ready'));
}
