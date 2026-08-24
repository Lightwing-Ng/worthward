/**
 * Shared Local store pagination primitives.
 *
 * Code version: v1.2.3
 * - Fixed: Range menus respect the nearest clipping ancestor when calculating
 *   available height, while keeping the scroll surface free of scrollbar paint.
 * - Added: Ellipses expose grouped hidden-page ranges through an accessible,
 *   viewport-aware menu shared by every pagination surface.
 * - Added: Fixed five-page chunks, canonical button markup, and the shared
 *   active-indicator motion used by every local pagination surface.
 * - Added: Transaction-detail tables can share a 100-row page-size contract.
 * - Added: Link rendering keeps server-backed pagination on the same builder
 *   and control contract as client-only pagination.
 * - Exposed: Canonical item markup is available to presentation-only demos
 *   that preserve an existing direct-child DOM contract.
 */

const LOCAL_STORE_PAGINATION_MODULE_VERSION = 'v1.2.3';
const LOCAL_STORE_PAGINATION_CHUNK_SIZE = 5;
const LOCAL_STORE_PAGINATION_DEFAULT_PAGE_SIZE = 10;
const LOCAL_STORE_PAGINATION_TRANSACTION_PAGE_SIZE = 100;
const LOCAL_STORE_PAGINATION_RANGE_CLOSE_DELAY_MS = 140;

let localStorePaginationRangeMenuId = 0;
let pinnedLocalStorePaginationRangePicker = null;
let localStorePaginationRangeCloseTimer = 0;
let didBindLocalStorePaginationRangeGlobals = false;

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
 * Group hidden pages and merge a short final fragment into its preceding range.
 */
export function buildLocalStorePaginationRanges(
    firstPage,
    lastPage,
    chunkSize = LOCAL_STORE_PAGINATION_CHUNK_SIZE,
) {
    const normalizedFirstPage = normalizePositiveInteger(firstPage);
    const normalizedLastPage = normalizePositiveInteger(lastPage);
    const normalizedChunkSize = normalizePositiveInteger(chunkSize, LOCAL_STORE_PAGINATION_CHUNK_SIZE);
    if (normalizedFirstPage > normalizedLastPage) return [];
    const ranges = [];
    for (
        let rangeStart = normalizedFirstPage;
        rangeStart <= normalizedLastPage;
        rangeStart += normalizedChunkSize
    ) {
        ranges.push([
            rangeStart,
            Math.min(rangeStart + normalizedChunkSize - 1, normalizedLastPage),
        ]);
    }
    const finalRange = ranges.at(-1);
    if (
        ranges.length > 1
        && finalRange[1] - finalRange[0] + 1 < normalizedChunkSize
    ) {
        ranges[ranges.length - 2][1] = finalRange[1];
        ranges.pop();
    }
    return ranges;
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
            items.push({
                kind: 'ellipsis',
                position: 'leading',
                ranges: buildLocalStorePaginationRanges(1, startPage - 1),
            });
        }

        for (let page = startPage; page <= endPage; page += 1) {
            items.push(createPageItem(page, normalizedCurrentPage));
        }

        if (!isLastChunk) {
            items.push({
                kind: 'ellipsis',
                position: 'trailing',
                ranges: buildLocalStorePaginationRanges(endPage + 1, normalizedTotalPages),
            });
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
        const position = item.position === 'leading' ? 'leading' : 'trailing';
        const direction = position === 'leading' ? 'earlier' : 'later';
        const ranges = Array.isArray(item.ranges) ? item.ranges : [];
        const rangeUnit = escapeHtmlAttribute(options.rangeUnit || 'pages');
        const rangeUnitLabel = rangeUnit.charAt(0).toUpperCase() + rangeUnit.slice(1);
        const menuIdPrefix = escapeHtmlAttribute(
            options.rangeMenuIdPrefix || 'local_store_pagination_ranges',
        );
        const menuId = `${menuIdPrefix}_${position}`;
        const rangeMarkup = ranges.map((range) => {
            const rangeStart = Number(range?.[0]);
            const rangeEnd = Number(range?.[1]);
            if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd)) return '';
            const targetAttributes = buildPageTargetAttributes(rangeStart, options);
            const href = typeof options.hrefForPage === 'function'
                ? String(options.hrefForPage(rangeStart) || '')
                : '';
            return buildPaginationControlMarkup({
                className: 'local-store-pagination-range-option',
                content: `${rangeStart}-${rangeEnd}`,
                href,
                attributes: `role="menuitem" ${targetAttributes} data-pagination-range-start="${rangeStart}" data-pagination-range-end="${rangeEnd}" aria-label="${rangeUnitLabel} ${rangeStart} through ${rangeEnd}"`,
            });
        }).join('');
        return '<span class="local-store-page-ellipsis local-store-pagination-range-picker" '
            + `data-pagination-ellipsis="${position}">`
            + '<button type="button" class="local-store-pagination-range-trigger" '
            + `aria-label="Show ${direction} ${rangeUnit}" aria-haspopup="menu" aria-expanded="false" `
            + `aria-controls="${menuId}" data-pagination-range-trigger>`
            + '<span class="local-store-page-ellipsis-dots" aria-hidden="true"></span></button>'
            + `<span id="${menuId}" class="local-store-pagination-range-menu" role="menu" `
            + `aria-label="${direction.charAt(0).toUpperCase() + direction.slice(1)} ${rangeUnit}" `
            + 'aria-hidden="true" data-pagination-range-menu>'
            + `<span class="local-store-pagination-range-grid">${rangeMarkup}</span></span></span>`;
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

function getLocalStorePaginationRangeElements(picker) {
    return {
        trigger: picker?.querySelector('[data-pagination-range-trigger]') || null,
        menu: picker?.querySelector('[data-pagination-range-menu]') || null,
    };
}

function getLocalStorePaginationRangeMenuContentHeight(menu) {
    const grid = menu?.querySelector('.local-store-pagination-range-grid');
    if (!menu || !grid) return 0;
    const style = window.getComputedStyle(menu);
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
    return grid.scrollHeight + paddingTop + paddingBottom;
}

function getLocalStorePaginationRangeMenuClipBounds(picker) {
    let ancestor = picker?.parentElement || null;
    while (ancestor) {
        const style = window.getComputedStyle(ancestor);
        if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
            const rect = ancestor.getBoundingClientRect();
            return {
                top: rect.top,
                bottom: rect.bottom,
            };
        }
        ancestor = ancestor.parentElement;
    }
    return {
        top: 0,
        bottom: window.innerHeight,
    };
}

function positionLocalStorePaginationRangeMenu(picker) {
    const {menu} = getLocalStorePaginationRangeElements(picker);
    if (!menu || !picker.classList.contains('is-open')) return;
    menu.classList.remove('is-below', 'is-scrollable');
    menu.style.removeProperty('--pagination-range-menu-shift-x');
    menu.style.removeProperty('--pagination-range-menu-max-height');
    const pickerRect = picker.getBoundingClientRect();
    const viewportInset = 12;
    const menuGap = 8;
    const clipBounds = getLocalStorePaginationRangeMenuClipBounds(picker);
    const clipTop = Math.max(viewportInset, clipBounds.top);
    const clipBottom = Math.min(window.innerHeight - viewportInset, clipBounds.bottom);
    const spaceAbove = Math.max(0, pickerRect.top - clipTop - menuGap);
    const spaceBelow = Math.max(0, clipBottom - pickerRect.bottom - menuGap);
    const naturalMenuHeight = getLocalStorePaginationRangeMenuContentHeight(menu);
    if (naturalMenuHeight > spaceAbove && spaceBelow > spaceAbove) {
        menu.classList.add('is-below');
    }
    const availableHeight = menu.classList.contains('is-below') ? spaceBelow : spaceAbove;
    menu.style.setProperty(
        '--pagination-range-menu-max-height',
        `${Math.max(1, availableHeight)}px`,
    );
    menu.classList.toggle('is-scrollable', naturalMenuHeight > menu.clientHeight + 1);
    const menuWidth = menu.offsetWidth;
    const idealMenuLeft = pickerRect.left + (pickerRect.width / 2) - (menuWidth / 2);
    let horizontalShift = 0;
    if (idealMenuLeft < viewportInset) {
        horizontalShift = viewportInset - idealMenuLeft;
    } else if (idealMenuLeft + menuWidth > window.innerWidth - viewportInset) {
        horizontalShift = window.innerWidth - viewportInset - idealMenuLeft - menuWidth;
    }
    menu.style.setProperty('--pagination-range-menu-shift-x', `${horizontalShift}px`);
}

function setLocalStorePaginationRangePickerOpen(
    picker,
    shouldOpen,
    {focusFirst = false} = {},
) {
    if (!picker) return;
    const {trigger, menu} = getLocalStorePaginationRangeElements(picker);
    if (shouldOpen) {
        document.querySelectorAll('.local-store-pagination-range-picker.is-open')
            .forEach((otherPicker) => {
                if (otherPicker !== picker) {
                    setLocalStorePaginationRangePickerOpen(otherPicker, false);
                }
            });
    }
    picker.classList.toggle('is-open', shouldOpen);
    picker.closest('.local-store-pagination')?.classList.toggle('has-open-range', shouldOpen);
    trigger?.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    menu?.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
    if (!shouldOpen) {
        menu?.classList.remove('is-below', 'is-scrollable');
        menu?.style.removeProperty('--pagination-range-menu-shift-x');
        menu?.style.removeProperty('--pagination-range-menu-max-height');
        return;
    }
    window.requestAnimationFrame(() => {
        positionLocalStorePaginationRangeMenu(picker);
        if (focusFirst) {
            menu?.querySelector('.local-store-pagination-range-option')?.focus();
        }
    });
}

function cancelLocalStorePaginationRangeClose() {
    if (!localStorePaginationRangeCloseTimer) return;
    window.clearTimeout(localStorePaginationRangeCloseTimer);
    localStorePaginationRangeCloseTimer = 0;
}

function scheduleLocalStorePaginationRangeClose(picker) {
    cancelLocalStorePaginationRangeClose();
    if (pinnedLocalStorePaginationRangePicker === picker) return;
    localStorePaginationRangeCloseTimer = window.setTimeout(() => {
        localStorePaginationRangeCloseTimer = 0;
        if (!picker.matches(':hover') && !picker.contains(document.activeElement)) {
            setLocalStorePaginationRangePickerOpen(picker, false);
        }
    }, LOCAL_STORE_PAGINATION_RANGE_CLOSE_DELAY_MS);
}

function closeAllLocalStorePaginationRangePickers() {
    cancelLocalStorePaginationRangeClose();
    pinnedLocalStorePaginationRangePicker = null;
    document.querySelectorAll('.local-store-pagination-range-picker.is-open')
        .forEach((picker) => setLocalStorePaginationRangePickerOpen(picker, false));
}

function ensureLocalStorePaginationRangeGlobalBindings() {
    if (didBindLocalStorePaginationRangeGlobals) return;
    didBindLocalStorePaginationRangeGlobals = true;
    document.addEventListener('pointerdown', (event) => {
        if (event.target?.closest?.('.local-store-pagination-range-picker')) return;
        closeAllLocalStorePaginationRangePickers();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const openPicker = document.querySelector('.local-store-pagination-range-picker.is-open');
        if (!openPicker) return;
        event.preventDefault();
        const {trigger} = getLocalStorePaginationRangeElements(openPicker);
        trigger?.focus();
        closeAllLocalStorePaginationRangePickers();
    });
    window.addEventListener('resize', () => {
        document.querySelectorAll('.local-store-pagination-range-picker.is-open')
            .forEach(positionLocalStorePaginationRangeMenu);
    }, {passive: true});
}

export function bindLocalStorePaginationRangePickers(pagination) {
    if (!pagination) return;
    const pickers = Array.from(
        pagination.querySelectorAll('.local-store-pagination-range-picker'),
    );
    if (!pickers.length) return;
    ensureLocalStorePaginationRangeGlobalBindings();
    pickers.forEach((picker) => {
        if (picker.dataset.paginationRangeBound === '1') return;
        picker.dataset.paginationRangeBound = '1';
        const {trigger, menu} = getLocalStorePaginationRangeElements(picker);
        picker.addEventListener('pointerenter', () => {
            cancelLocalStorePaginationRangeClose();
            setLocalStorePaginationRangePickerOpen(picker, true);
        });
        picker.addEventListener('pointerleave', () => scheduleLocalStorePaginationRangeClose(picker));
        picker.addEventListener('focusin', () => {
            cancelLocalStorePaginationRangeClose();
            setLocalStorePaginationRangePickerOpen(picker, true);
        });
        picker.addEventListener('focusout', () => scheduleLocalStorePaginationRangeClose(picker));
        trigger?.addEventListener('click', () => {
            cancelLocalStorePaginationRangeClose();
            const shouldPin = pinnedLocalStorePaginationRangePicker !== picker;
            if (pinnedLocalStorePaginationRangePicker && pinnedLocalStorePaginationRangePicker !== picker) {
                setLocalStorePaginationRangePickerOpen(
                    pinnedLocalStorePaginationRangePicker,
                    false,
                );
            }
            pinnedLocalStorePaginationRangePicker = shouldPin ? picker : null;
            setLocalStorePaginationRangePickerOpen(
                picker,
                shouldPin || picker.matches(':hover'),
            );
        });
        trigger?.addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowDown') return;
            event.preventDefault();
            pinnedLocalStorePaginationRangePicker = picker;
            setLocalStorePaginationRangePickerOpen(picker, true, {focusFirst: true});
        });
        menu?.addEventListener('keydown', (event) => {
            const rangeOptions = Array.from(
                menu.querySelectorAll('.local-store-pagination-range-option'),
            );
            const currentIndex = rangeOptions.indexOf(document.activeElement);
            let nextIndex = currentIndex;
            if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                nextIndex = Math.min(rangeOptions.length - 1, currentIndex + 1);
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                nextIndex = Math.max(0, currentIndex - 1);
            } else if (event.key === 'Home') {
                nextIndex = 0;
            } else if (event.key === 'End') {
                nextIndex = rangeOptions.length - 1;
            } else {
                return;
            }
            event.preventDefault();
            rangeOptions[nextIndex]?.focus();
        });
        menu?.addEventListener('click', (event) => {
            if (!event.target?.closest?.('.local-store-pagination-range-option')) return;
            closeAllLocalStorePaginationRangePickers();
        });
    });
}

export function renderLocalStorePagination(pagination, state, options = {}) {
    if (!pagination) return;
    cancelLocalStorePaginationRangeClose();
    if (pinnedLocalStorePaginationRangePicker && pagination.contains(pinnedLocalStorePaginationRangePicker)) {
        pinnedLocalStorePaginationRangePicker = null;
    }
    clearPaginationAnimationTimer(pagination);
    pagination.classList.remove('is-animated', 'is-animating', 'has-open-range');
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
    const rangeMenuIdPrefix = options.rangeMenuIdPrefix
        || pagination.dataset.paginationRangeMenuIdPrefix
        || pagination.id
        || `local_store_pagination_${++localStorePaginationRangeMenuId}`;
    pagination.dataset.paginationRangeMenuIdPrefix = rangeMenuIdPrefix;
    const renderOptions = {...options, rangeMenuIdPrefix};
    pagination.innerHTML = `<span class="local-store-pagination-indicator" aria-hidden="true"></span>${items.map((item) => renderLocalStorePaginationItem(item, renderOptions)).join('')}`;
    bindLocalStorePaginationRangePickers(pagination);
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
    LOCAL_STORE_PAGINATION_TRANSACTION_PAGE_SIZE,
    LOCAL_STORE_PAGINATION_MODULE_VERSION,
};

if (typeof window !== 'undefined') {
    window.ANTIGRAVITY_LOCAL_STORE_PAGINATION = Object.freeze({
        LOCAL_STORE_PAGINATION_CHUNK_SIZE,
        LOCAL_STORE_PAGINATION_DEFAULT_PAGE_SIZE,
        LOCAL_STORE_PAGINATION_TRANSACTION_PAGE_SIZE,
        LOCAL_STORE_PAGINATION_MODULE_VERSION,
        animateLocalStorePaginationIndicator,
        bindLocalStorePagination,
        bindLocalStorePaginationRangePickers,
        buildLocalStorePagination,
        buildLocalStorePaginationRanges,
        captureLocalStorePaginationAnimation,
        ensureLocalStorePaginationIndicator,
        getLocalStorePaginationMotionDurationMs,
        positionLocalStorePaginationIndicator,
        renderLocalStorePaginationItem,
        renderLocalStorePagination,
        setLocalStorePaginationActivePage,
        syncLocalStorePaginationActivePage,
    });
    window.dispatchEvent(new Event('antigravity:local-store-pagination-ready'));
}
