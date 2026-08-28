/**
 * Investment realtime value transition helpers.
 *
 * Code version: v1.3.2
 * - Fixed: Holdings live values retain their CSS-owned geometry instead of
 *   adding content-measured minimum dimensions during quote updates.
 * - Changed: Every quote poll now awaits the market-session refresh before
 *   deciding eligibility or applying quotes, so minute placement cannot lag
 *   behind a slower session-state request.
 * - Added: Realtime quote scheduling, cancellation, and active/idle cadence are encapsulated behind a tested poller.
 * - Changed: Live digit transitions share the application Motion Core scheduler instead of creating one rAF loop per digit.
 */

import {parseNumericDisplayValue} from '../numeric-display.js?v=numeric-display-v1.1.0';

export const INVESTMENT_REALTIME_MODULE_VERSION = 'v1.3.2';

export function createInvestmentRealtimeQuotePoller({
    pollDelayMs = 60_000,
    idleDelayMs = 60_000,
    isDisposed = () => false,
    hasData = () => true,
    getTickers = () => [],
    shouldRun = () => false,
    requestQuotes = async () => [],
    applyQuotes = () => {},
    resetState = () => {},
    refreshSession = async () => null,
    isLifecycleInterrupted = () => false,
    onError = () => {},
    setTimeoutFn = globalThis.setTimeout,
    clearTimeoutFn = globalThis.clearTimeout,
    AbortControllerClass = globalThis.AbortController,
} = {}) {
    let timer = 0;
    let abortController = null;
    let inflight = false;

    function stop() {
        if (timer) {
            clearTimeoutFn(timer);
            timer = 0;
        }
        abortController?.abort();
        abortController = null;
        inflight = false;
    }

    function schedule() {
        if (isDisposed() || !hasData()) return;
        const tickers = getTickers();
        if (!Array.isArray(tickers) || !tickers.length) return;
        if (timer) clearTimeoutFn(timer);
        const delayMs = shouldRun() ? pollDelayMs : idleDelayMs;
        timer = setTimeoutFn(() => {
            timer = 0;
            void poll();
        }, delayMs);
    }

    async function poll() {
        if (isDisposed() || inflight) return;
        inflight = true;
        const activeAbortController = new AbortControllerClass();
        abortController = activeAbortController;
        try {
            await Promise.resolve(refreshSession()).catch(() => null);
            if (isDisposed() || activeAbortController.signal.aborted) return;
            const tickers = getTickers();
            if (!Array.isArray(tickers) || !tickers.length) return;
            if (!shouldRun()) {
                resetState();
                return;
            }
            const quotes = await requestQuotes(tickers, {signal: activeAbortController.signal});
            if (quotes.length) applyQuotes(quotes);
            else if (shouldRun()) resetState();
        } catch (error) {
            if (!isLifecycleInterrupted(error)) onError(error);
        } finally {
            if (abortController === activeAbortController) {
                inflight = false;
                abortController = null;
                schedule();
            }
        }
    }

    function restart() {
        stop();
        return poll();
    }

    return {
        poll,
        restart,
        schedule,
        stop,
    };
}

export function resolveInvestmentLiveNumberDirection(previousValue, nextValue, epsilon = 1e-9) {
    const previousNumber = Number(previousValue);
    const nextNumber = Number(nextValue);
    if (!Number.isFinite(previousNumber) || !Number.isFinite(nextNumber)) return 'flat';
    if (Math.abs(nextNumber - previousNumber) <= epsilon) return 'flat';
    return nextNumber > previousNumber ? 'rise' : 'fall';
}

export function parseInvestmentLiveDisplaySegments(display) {
    const raw = String(display ?? '').trim();
    if (!raw || raw === '-') return null;
    const parsed = parseNumericDisplayValue(raw);
    if (!parsed.isNumeric || !parsed.decimalPart) {
        return {
            isStructured: false,
            chars: Array.from(raw),
        };
    }
    return {
        isStructured: true,
        prefix: Array.from(parsed.prefix),
        integer: Array.from(parsed.integerPart),
        dot: ['.'],
        fraction: Array.from(parsed.decimalPart),
        suffix: Array.from(parsed.suffix),
    };
}

export function alignInvestmentLiveSegmentChars(previousChars, nextChars, align = 'left') {
    const safePrevious = Array.isArray(previousChars) ? previousChars : [];
    const safeNext = Array.isArray(nextChars) ? nextChars : [];
    const maxLength = Math.max(safePrevious.length, safeNext.length);
    const pairs = [];
    for (let index = 0; index < maxLength; index += 1) {
        const previousIndex = align === 'right'
            ? index - (maxLength - safePrevious.length)
            : index;
        const nextIndex = align === 'right'
            ? index - (maxLength - safeNext.length)
            : index;
        const previousChar = previousIndex >= 0 && previousIndex < safePrevious.length
            ? safePrevious[previousIndex]
            : '';
        const nextChar = nextIndex >= 0 && nextIndex < safeNext.length
            ? safeNext[nextIndex]
            : '';
        if (previousChar || nextChar) pairs.push({previousChar, nextChar});
    }
    return pairs;
}

export function buildInvestmentLiveSegmentPairs(previousDisplay, nextDisplay) {
    const previousSegments = parseInvestmentLiveDisplaySegments(previousDisplay);
    const nextSegments = parseInvestmentLiveDisplaySegments(nextDisplay);
    if (!previousSegments && !nextSegments) return [];
    if (!previousSegments || !nextSegments) {
        return alignInvestmentLiveSegmentChars(
            Array.from(String(previousDisplay || '')),
            Array.from(String(nextDisplay || '')),
            'right',
        ).map((pair) => ({...pair, partClassName: ''}));
    }
    if (!previousSegments.isStructured || !nextSegments.isStructured) {
        const previousChars = previousSegments.chars || Array.from(String(previousDisplay || ''));
        const nextChars = nextSegments.chars || Array.from(String(nextDisplay || ''));
        return alignInvestmentLiveSegmentChars(previousChars, nextChars, 'right')
            .map((pair) => ({...pair, partClassName: ''}));
    }
    const segmentOrder = ['prefix', 'integer', 'dot', 'fraction', 'suffix'];
    const segmentAlign = {
        prefix: 'left',
        integer: 'right',
        dot: 'left',
        fraction: 'left',
        suffix: 'left',
    };
    const segmentPartClass = {
        prefix: 'workspace-metric-value-major',
        integer: 'workspace-metric-value-major',
        dot: 'workspace-metric-value-minor',
        fraction: 'workspace-metric-value-minor',
        suffix: 'workspace-metric-value-suffix',
    };
    return segmentOrder.flatMap((segmentKey) => (
        alignInvestmentLiveSegmentChars(
            previousSegments[segmentKey],
            nextSegments[segmentKey],
            segmentAlign[segmentKey],
        ).map((pair) => ({
            ...pair,
            partClassName: segmentPartClass[segmentKey],
        }))
    ));
}

export function createInvestmentLiveValueAnimator({
    epsilon = 1e-9,
    animationMs = 520,
    easeOutCubic,
    renderWorkspaceMetricValueContent,
    windowRef = globalThis.window,
    documentRef = globalThis.document,
    HTMLElementClass = globalThis.HTMLElement,
    scheduler = windowRef?.AntigravityMotion?.scheduler,
} = {}) {
    const charWidthCache = new Map();
    const animationCancels = new WeakMap();
    const isElement = (value) => (
        typeof HTMLElementClass === 'function' && value instanceof HTMLElementClass
    );

    function getMeasurementFingerprint(node, partClassName = '') {
        if (!isElement(node)) return '';
        const styles = windowRef.getComputedStyle(node);
        return [
            partClassName,
            styles.fontFamily,
            styles.fontSize,
            styles.fontWeight,
            styles.fontStyle,
            styles.letterSpacing,
            styles.fontVariantNumeric,
        ].join('|');
    }

    function measureCharWidth(node, char, partClassName = '') {
        const safeChar = String(char || '0');
        const cacheKey = `${getMeasurementFingerprint(node, partClassName)}::${safeChar}`;
        if (charWidthCache.has(cacheKey)) return charWidthCache.get(cacheKey);
        if (!isElement(node) || !isElement(documentRef?.body)) return 0;
        const wrapper = documentRef.createElement('span');
        wrapper.className = node.className;
        Object.assign(wrapper.style, {
            position: 'absolute',
            left: '-10000px',
            top: '0',
            visibility: 'hidden',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
        });
        const measurer = documentRef.createElement('span');
        measurer.className = partClassName || 'workspace-metric-value-major';
        measurer.style.whiteSpace = 'pre';
        measurer.textContent = safeChar;
        wrapper.appendChild(measurer);
        documentRef.body.appendChild(wrapper);
        const width = Math.ceil(Math.max(0, measurer.getBoundingClientRect().width || 0));
        wrapper.remove();
        charWidthCache.set(cacheKey, width);
        return width;
    }

    function applyDigitSlotWidth(digit, width) {
        if (!isElement(digit) || !Number.isFinite(width) || width <= 0) return;
        const pixelWidth = `${Math.ceil(width)}px`;
        digit.style.width = pixelWidth;
        digit.style.minWidth = pixelWidth;
        digit.style.maxWidth = pixelWidth;
    }

    function createDigit(previousChar, nextChar, direction, slotWidth = 0) {
        const digit = documentRef.createElement('span');
        const previous = String(previousChar || '');
        const next = String(nextChar || '');
        const changed = previous !== next && direction !== 'flat' && Boolean(previous || next);
        applyDigitSlotWidth(digit, slotWidth);
        if (!changed) {
            digit.className = 'investment-live-digit';
            digit.textContent = next || previous;
            return {digit, animate: false};
        }
        digit.className = `investment-live-digit investment-live-digit--changed investment-live-digit--${direction}`;
        if (previous) {
            const oldFace = documentRef.createElement('span');
            oldFace.className = 'investment-live-digit-face investment-live-digit-face--old';
            oldFace.textContent = previous;
            digit.appendChild(oldFace);
        }
        if (next) {
            const newFace = documentRef.createElement('span');
            newFace.className = 'investment-live-digit-face investment-live-digit-face--new';
            newFace.textContent = next;
            newFace.style.color = direction === 'rise'
                ? 'var(--theme-accent-positive)'
                : 'var(--theme-accent-secondary)';
            digit.appendChild(newFace);
        }
        return {digit, animate: true};
    }

    function applyDigitFrame(digit, direction, eased) {
        const oldFace = digit.querySelector('.investment-live-digit-face--old');
        const newFace = digit.querySelector('.investment-live-digit-face--new');
        const isRise = direction === 'rise';
        const oldYOffset = isRise ? (-100 * eased) : (100 * eased);
        const newYOffset = isRise ? (100 * (1 - eased)) : (-100 * (1 - eased));
        if (isElement(oldFace)) {
            oldFace.style.opacity = String(1 - eased);
            oldFace.style.transform = `translate(-50%, calc(-50% + ${oldYOffset}%))`;
        }
        if (isElement(newFace)) {
            newFace.style.opacity = String(eased);
            newFace.style.transform = `translate(-50%, calc(-50% + ${newYOffset}%))`;
        }
    }

    function runDigitAnimations(entries, onComplete, animationKey) {
        const animatedEntries = (Array.isArray(entries) ? entries : []).filter((entry) => entry?.animate);
        if (!animatedEntries.length) {
            onComplete?.();
            return () => {};
        }
        const render = (eased) => animatedEntries.forEach(({digit, direction}) => {
            applyDigitFrame(digit, direction, eased);
        });
        render(0);
        if (scheduler?.animate) {
            return scheduler.animate({
                key: animationKey,
                duration: animationMs,
                ease: (progress) => easeOutCubic(progress),
                update: (eased) => render(eased),
                complete: onComplete,
            });
        }

        const startTime = globalThis.performance.now();
        let frameId = 0;
        const step = (now) => {
            const progress = Math.min(1, (now - startTime) / animationMs);
            render(easeOutCubic(progress));
            if (progress < 1) {
                frameId = windowRef.requestAnimationFrame(step);
                return;
            }
            onComplete?.();
        };
        frameId = windowRef.requestAnimationFrame(step);
        return () => {
            if (frameId) windowRef.cancelAnimationFrame(frameId);
        };
    }

    function cancelValueAnimation(node) {
        animationCancels.get(node)?.();
        animationCancels.delete(node);
    }

    function buildValueFragment(referenceNode, previousDisplay, nextDisplay, direction, useSplit = false) {
        const fragment = documentRef.createDocumentFragment();
        const animatedDigits = [];
        let splitWrapper = null;
        let splitPartClassName = '';
        const ensureSplitWrapper = (partClassName) => {
            if (!useSplit) return fragment;
            const safeClassName = partClassName || 'workspace-metric-value-major';
            if (splitWrapper && splitPartClassName === safeClassName) return splitWrapper;
            splitWrapper = documentRef.createElement('span');
            splitWrapper.className = safeClassName;
            splitPartClassName = safeClassName;
            fragment.appendChild(splitWrapper);
            return splitWrapper;
        };
        buildInvestmentLiveSegmentPairs(previousDisplay, nextDisplay).forEach(({
            previousChar,
            nextChar,
            partClassName,
        }) => {
            const slotWidth = Math.max(
                ...[previousChar, nextChar]
                    .filter(Boolean)
                    .map((char) => measureCharWidth(referenceNode, char, partClassName)),
                measureCharWidth(referenceNode, '0', partClassName),
            );
            const {digit, animate} = createDigit(previousChar, nextChar, direction, slotWidth);
            ensureSplitWrapper(partClassName).appendChild(digit);
            if (animate) animatedDigits.push({digit, direction, animate});
        });
        return {fragment, animatedDigits};
    }

    function renderStaticContent(node, display, useSplit) {
        if (!isElement(node)) return;
        if (useSplit) node.innerHTML = renderWorkspaceMetricValueContent(display);
        else node.textContent = display;
    }

    function measureStaticContent(node, display, useSplit) {
        if (!isElement(node) || !isElement(documentRef?.body)) return {width: 0, height: 0};
        const clone = documentRef.createElement('span');
        clone.className = node.className;
        clone.classList.remove('is-live-rise', 'is-live-fall');
        Object.assign(clone.style, {
            position: 'absolute',
            left: '-10000px',
            top: '0',
            visibility: 'hidden',
            pointerEvents: 'none',
            minWidth: '0',
            minHeight: '0',
            whiteSpace: 'nowrap',
        });
        renderStaticContent(clone, display, useSplit);
        const host = isElement(node.parentElement) ? node.parentElement : documentRef.body;
        host.appendChild(clone);
        const rect = clone.getBoundingClientRect();
        clone.remove();
        return {
            width: Math.ceil(Math.max(0, rect.width || 0)),
            height: Math.ceil(Math.max(0, rect.height || 0)),
        };
    }

    function reserveValueLayout(node, previousDisplay, nextDisplay, useSplit) {
        if (!isElement(node)) return;
        if (node.closest('#investment_holdings_panel')) return;
        const currentRect = node.getBoundingClientRect();
        const previousSize = measureStaticContent(node, previousDisplay, useSplit);
        const nextSize = measureStaticContent(node, nextDisplay, useSplit);
        const reserveWidth = Math.ceil(Math.max(
            Number(node.dataset.investmentLiveReserveWidth || 0),
            currentRect.width || 0,
            previousSize.width,
            nextSize.width,
        ));
        const reserveHeight = Math.ceil(Math.max(
            Number(node.dataset.investmentLiveReserveHeight || 0),
            currentRect.height || 0,
            previousSize.height,
            nextSize.height,
        ));
        if (reserveWidth > 0) {
            node.dataset.investmentLiveReserveWidth = String(reserveWidth);
            node.style.minWidth = `${reserveWidth}px`;
        }
        if (reserveHeight > 0) {
            node.dataset.investmentLiveReserveHeight = String(reserveHeight);
            node.style.minHeight = `${reserveHeight}px`;
        }
    }

    function shouldUseSplitValue(node) {
        return isElement(node) && (
            node.classList.contains('investment-stock-details-metric-value')
            || node.closest('.investment-holdings-summary-row')
        );
    }

    function updateInvestmentLiveValueNode(node, nextDisplay, nextNumber) {
        if (!isElement(node)) return;
        const previousDisplay = String(node.dataset.investmentLiveDisplay || node.textContent || '').trim();
        const nextDisplayNormalized = String(nextDisplay ?? '').trim();
        const previousNumber = String(node.dataset.investmentLiveNumber || '').trim();
        const nextNumberNormalized = Number.isFinite(Number(nextNumber)) ? String(nextNumber) : '';
        if (previousDisplay === nextDisplayNormalized && previousNumber === nextNumberNormalized) return;
        cancelValueAnimation(node);
        const direction = resolveInvestmentLiveNumberDirection(
            node.dataset.investmentLiveNumber,
            nextNumber,
            epsilon,
        );
        const useSplit = shouldUseSplitValue(node);
        const shouldAnimate = Boolean(
            previousDisplay
            && previousDisplay !== nextDisplayNormalized
            && direction !== 'flat'
            && !windowRef.matchMedia?.('(prefers-reduced-motion: reduce)').matches
            && !node.closest('#investment_holdings_panel')
        );
        reserveValueLayout(node, previousDisplay, nextDisplayNormalized, useSplit);
        node.classList.remove('is-live-rise', 'is-live-fall');
        node.replaceChildren();
        if (shouldAnimate) {
            const animationToken = `${Date.now()}:${Math.random()}`;
            node.dataset.investmentLiveAnimationToken = animationToken;
            const {fragment, animatedDigits} = buildValueFragment(
                node,
                previousDisplay,
                nextDisplayNormalized,
                direction,
                useSplit,
            );
            node.appendChild(fragment);
            node.classList.add(direction === 'rise' ? 'is-live-rise' : 'is-live-fall');
            const cancelAnimation = runDigitAnimations(animatedDigits, () => {
                if (!node.isConnected || node.dataset.investmentLiveAnimationToken !== animationToken) return;
                renderStaticContent(node, nextDisplayNormalized, useSplit);
                node.classList.remove('is-live-rise', 'is-live-fall');
                delete node.dataset.investmentLiveAnimationToken;
                animationCancels.delete(node);
            }, node);
            animationCancels.set(node, cancelAnimation);
        } else {
            delete node.dataset.investmentLiveAnimationToken;
            renderStaticContent(node, nextDisplayNormalized, useSplit);
        }
        node.dataset.investmentLiveDisplay = nextDisplayNormalized;
        if (nextNumberNormalized) node.dataset.investmentLiveNumber = nextNumberNormalized;
        else delete node.dataset.investmentLiveNumber;
    }

    function syncInvestmentLiveTone(targets, numericValue, {enableSignedTone = false} = {}) {
        (Array.isArray(targets) ? targets : [targets]).forEach((element) => {
            if (!isElement(element)) return;
            if (!enableSignedTone || !Number.isFinite(Number(numericValue))) {
                element.classList.remove('investment-holdings-value-positive', 'investment-holdings-value-negative');
                return;
            }
            element.classList.toggle('investment-holdings-value-positive', Number(numericValue) >= 0);
            element.classList.toggle('investment-holdings-value-negative', Number(numericValue) < 0);
        });
    }

    function syncInvestmentLiveDirectionTone(targets, previousValue, nextValue) {
        const direction = resolveInvestmentLiveNumberDirection(previousValue, nextValue, epsilon);
        if (direction === 'flat') return;
        (Array.isArray(targets) ? targets : [targets]).forEach((element) => {
            if (!isElement(element)) return;
            element.classList.remove('investment-holdings-value-positive', 'investment-holdings-value-negative');
            element.classList.add(
                direction === 'rise'
                    ? 'investment-holdings-value-positive'
                    : 'investment-holdings-value-negative',
            );
        });
    }

    return {
        syncInvestmentLiveDirectionTone,
        syncInvestmentLiveTone,
        updateInvestmentLiveValueNode,
    };
}
