/**
 * Formatter-preserving cyclic numeric animation with shared scheduling.
 * Code version: v1.0.0
 */

export const ANIMATED_NUMBER_VERSION = 'v1.0.0';
export const ANIMATED_NUMBER_TUNING = Object.freeze({
    stiffness: 340,
    damping: 26,
    mass: 1,
    staggerMs: 16,
    maxDeltaSeconds: 1 / 30,
    reducedDurationMs: 120,
    signDurationMs: 200,
    flashDurationMs: 700,
    positionTolerance: 0.001,
    velocityTolerance: 0.002,
});

const fallbackSchedulers = new WeakMap();
const documentRegistries = new WeakMap();
const modulo = (value, divisor) => ((value % divisor) + divisor) % divisor;
const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));
const finiteValue = (value) => (
    (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
        && Number.isFinite(Number(value))
);

export function getCyclicDigitTarget(position, digit, direction) {
    const targetDigit = modulo(Number(digit), 10);
    if (!Number.isFinite(position) || !Number.isFinite(targetDigit)) return targetDigit;
    const cycle = Math.floor(position / 10) * 10;
    let target = cycle + targetDigit;
    if (direction >= 0 && target < position - 1e-9) target += 10;
    if (direction < 0 && target > position + 1e-9) target -= 10;
    return target;
}

export function advanceNumberSpring(position, velocity, target, deltaSeconds, tuning = ANIMATED_NUMBER_TUNING) {
    const dt = clamp(Number(deltaSeconds) || 0, 0, ANIMATED_NUMBER_TUNING.maxDeltaSeconds);
    if (!dt) return {position, velocity};
    const stiffness = Math.max(0.001, Number(tuning.stiffness) || ANIMATED_NUMBER_TUNING.stiffness);
    const mass = Math.max(0.001, Number(tuning.mass) || ANIMATED_NUMBER_TUNING.mass);
    const damping = Number.isFinite(Number(tuning.damping))
        ? Math.max(0, Number(tuning.damping)) : ANIMATED_NUMBER_TUNING.damping;
    const decay = damping / (2 * mass);
    const displacement = position - target;
    const discriminant = decay * decay - stiffness / mass;
    if (Math.abs(discriminant) < 1e-9) {
        const coefficient = velocity + decay * displacement;
        const envelope = Math.exp(-decay * dt);
        return {
            position: target + envelope * (displacement + coefficient * dt),
            velocity: envelope * (velocity - decay * coefficient * dt),
        };
    }
    if (discriminant > 0) {
        const root = Math.sqrt(discriminant);
        const firstRate = -decay + root;
        const secondRate = -decay - root;
        const first = (velocity - secondRate * displacement) / (firstRate - secondRate);
        const second = displacement - first;
        const firstTerm = first * Math.exp(firstRate * dt);
        const secondTerm = second * Math.exp(secondRate * dt);
        return {
            position: target + firstTerm + secondTerm,
            velocity: firstRate * firstTerm + secondRate * secondTerm,
        };
    }
    const frequency = Math.sqrt(-discriminant);
    const coefficient = (velocity + decay * displacement) / frequency;
    const envelope = Math.exp(-decay * dt);
    const cosine = Math.cos(frequency * dt);
    const sine = Math.sin(frequency * dt);
    return {
        position: target + envelope * (displacement * cosine + coefficient * sine),
        velocity: envelope * (velocity * cosine - (decay * coefficient + frequency * displacement) * sine),
    };
}

function getFallbackScheduler(windowRef) {
    if (!windowRef || typeof windowRef.requestAnimationFrame !== 'function') return null;
    if (fallbackSchedulers.has(windowRef)) return fallbackSchedulers.get(windowRef);
    const tasks = new Map();
    let frameId = null;
    const schedule = () => {
        if (frameId !== null || !tasks.size) return;
        frameId = windowRef.requestAnimationFrame((now) => {
            frameId = null;
            [...tasks.entries()].forEach(([key, step]) => {
                if (tasks.get(key) === step && !step(now)) tasks.delete(key);
            });
            schedule();
        });
    };
    const cancel = (key) => {
        tasks.delete(key);
        if (!tasks.size && frameId !== null) {
            windowRef.cancelAnimationFrame(frameId);
            frameId = null;
        }
    };
    const scheduler = {
        frame(key, step) {
            tasks.set(key, step);
            schedule();
            return () => cancel(key);
        },
        get activeCount() { return tasks.size; },
    };
    fallbackSchedulers.set(windowRef, scheduler);
    return scheduler;
}

function registerInstance(documentRef, windowRef, instance) {
    let registry = documentRegistries.get(documentRef);
    if (!registry) {
        const instances = new Set();
        const byNode = new Map();
        const pendingMeasurements = new Set();
        const knownHeights = new WeakMap();
        const measurementKey = Symbol('animated-number-layout');
        let cancelMeasurement = null;
        const requestMeasurements = (entries = instances) => {
            entries.forEach((entry) => pendingMeasurements.add(entry));
            if (documentRef.hidden || documentRef.visibilityState === 'hidden') return;
            if (!pendingMeasurements.size || cancelMeasurement) return;
            const flush = () => {
                cancelMeasurement = null;
                [...pendingMeasurements].forEach((entry) => {
                    pendingMeasurements.delete(entry);
                    if (instances.has(entry)) entry.remeasure();
                });
                return false;
            };
            const scheduler = [...instances][0]?.scheduler;
            if (scheduler) cancelMeasurement = scheduler.frame(measurementKey, flush);
            else flush();
        };
        const onResize = () => requestMeasurements();
        const ResizeObserverClass = windowRef?.ResizeObserver;
        const resizeObserver = ResizeObserverClass ? new ResizeObserverClass((entries) => {
            const changed = [];
            entries.forEach((entry) => {
                const height = entry.contentRect?.height;
                if (knownHeights.get(entry.target) === height) return;
                knownHeights.set(entry.target, height);
                const instanceEntry = byNode.get(entry.target);
                if (instanceEntry) {
                    if (height === 0 && entry.target.getClientRects?.().length === 0) instanceEntry.jump();
                    changed.push(instanceEntry);
                }
            });
            requestMeasurements(changed);
        }) : null;
        const onVisibility = () => {
            if (documentRef.hidden || documentRef.visibilityState === 'hidden') {
                cancelMeasurement?.();
                cancelMeasurement = null;
                pendingMeasurements.clear();
                instances.forEach((entry) => entry.jump());
            } else requestMeasurements();
        };
        const Observer = windowRef?.MutationObserver;
        const observer = Observer ? new Observer(() => {
            [...instances].forEach((entry) => {
                if (entry.node.isConnected) entry.seenConnected = true;
                else if (entry.seenConnected) entry.destroy();
            });
        }) : null;
        observer?.observe(documentRef.documentElement || documentRef, {childList: true, subtree: true});
        documentRef.addEventListener?.('visibilitychange', onVisibility);
        windowRef?.addEventListener?.('resize', onResize);
        documentRef.fonts?.addEventListener?.('loadingdone', onResize);
        documentRef.fonts?.ready?.then(() => requestMeasurements()).catch(() => {});
        registry = {
            instances, byNode, observer, resizeObserver, onVisibility, onResize,
            cancelMeasurement: () => { cancelMeasurement?.(); pendingMeasurements.clear(); },
        };
        documentRegistries.set(documentRef, registry);
    }
    registry.instances.add(instance);
    registry.byNode.set(instance.node, instance);
    registry.resizeObserver?.observe(instance.node);
    return () => {
        registry.instances.delete(instance);
        registry.byNode.delete(instance.node);
        registry.resizeObserver?.unobserve(instance.node);
        if (registry.instances.size) return;
        registry.observer?.disconnect();
        registry.resizeObserver?.disconnect();
        registry.cancelMeasurement();
        documentRef.removeEventListener?.('visibilitychange', registry.onVisibility);
        windowRef?.removeEventListener?.('resize', registry.onResize);
        documentRef.fonts?.removeEventListener?.('loadingdone', registry.onResize);
        documentRegistries.delete(documentRef);
    };
}

function describeColumns(parts) {
    const descriptors = [];
    parts.forEach((part, partIndex) => {
        const chunks = String(part.text).match(/[0-9]|[+\-−]|[^0-9+\-−]+/gu) || [];
        const digitCount = chunks.filter((chunk) => /^[0-9]$/.test(chunk)).length;
        let remainingDigits = digitCount;
        const staticCounts = new Map();
        chunks.forEach((text) => {
            const kind = /^[0-9]$/.test(text) ? 'digit' : /^[+\-−]$/.test(text) ? 'sign' : 'static';
            let key;
            if (kind === 'digit') key = `d:${partIndex}:${--remainingDigits}`;
            else {
                const anchor = kind === 'sign' ? 'sign'
                    : remainingDigits === digitCount ? 'prefix'
                        : remainingDigits === 0 ? 'suffix' : `separator:${remainingDigits}`;
                const occurrence = staticCounts.get(anchor) || 0;
                staticCounts.set(anchor, occurrence + 1);
                key = `${anchor}:${partIndex}:${occurrence}`;
            }
            descriptors.push({key, text, kind, partIndex});
        });
    });
    let rank = 0;
    for (let index = descriptors.length - 1; index >= 0; index -= 1) {
        if (descriptors[index].kind === 'digit') descriptors[index].rank = rank++;
    }
    return descriptors;
}

export function createAnimatedNumber(node, options = {}) {
    if (!node || typeof node.appendChild !== 'function') throw new TypeError('AnimatedNumber requires a DOM element.');
    const documentRef = options.documentRef || node.ownerDocument;
    const windowRef = options.windowRef || documentRef?.defaultView || globalThis.window;
    if (!documentRef?.createElement) throw new TypeError('AnimatedNumber requires a document.');
    const scheduler = options.scheduler || windowRef?.WorthwardMotion?.scheduler || getFallbackScheduler(windowRef);
    const mediaQuery = windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)');
    const partsFormatter = typeof options.parts === 'function'
        ? options.parts : (display) => [{text: display, className: ''}];
    let formatter = typeof options.format === 'function' ? options.format : (value) => String(value ?? '');
    const columns = new Map();
    const partNodes = new Map();
    const frameKey = Symbol('animated-number');
    let cancelFrame = null;
    let lastTimestamp = null;
    let destroyed = false;
    let mounted = false;
    let parked = false;
    let lastValue;
    let lastValid = false;
    let display = '';
    let screenReader = null;
    let targetParts = [];
    let reducedElapsed = null;
    let reducedApplied = false;
    let reducedInitialOpacity = 1;
    let visualOpacity = 1;
    let flashElapsed = null;
    let flashDuration = ANIMATED_NUMBER_TUNING.flashDurationMs;
    let flashSerial = 0;

    const setState = (state) => {
        if (state === 'idle' && mounted) parkColumns();
        node.dataset.numberState = state;
        node.dataset.animatedNumberState = state === 'idle' ? 'idle' : 'animating';
    };
    const isHidden = () => documentRef.hidden || documentRef.visibilityState === 'hidden';
    const stopFrame = () => {
        cancelFrame?.();
        cancelFrame = null;
        lastTimestamp = null;
    };
    const createSpan = (className) => {
        const span = documentRef.createElement('span');
        if (className) span.className = className;
        return span;
    };
    const measure = (column) => {
        const bounds = column.measure.getBoundingClientRect();
        column.naturalWidth = bounds.width;
        if (bounds.height > 0) {
            const offset = bounds.top - column.node.getBoundingClientRect().top;
            column.window.style.top = `${offset}px`;
            column.window.style.bottom = 'auto';
            column.window.style.height = `${bounds.height}px`;
            if (column.face) column.face.style.lineHeight = `${bounds.height}px`;
            if (column.previousFace) column.previousFace.style.lineHeight = `${bounds.height}px`;
        }
        if (bounds.height > 0 && bounds.height !== column.height) {
            column.height = bounds.height;
            column.glyphs.forEach((glyph) => {
                glyph.style.height = `${bounds.height}px`;
                glyph.style.lineHeight = `${bounds.height}px`;
            });
        }
        return bounds.width;
    };
    const setVisualOpacity = (opacity) => {
        visualOpacity = opacity;
        partNodes.forEach((part) => {
            if (opacity === 1) part.style.removeProperty('opacity');
            else part.style.opacity = String(opacity);
        });
    };
    const writeContentWidth = () => {
        if (parked) {
            let nativeWidth = 0;
            partNodes.forEach((part) => { nativeWidth += part.getBoundingClientRect().width; });
            node.style.setProperty('--animated-number-content-width', `${nativeWidth}px`);
            return;
        }
        let width = 0;
        columns.forEach((column) => { width += Math.max(0, column.widthActive ? column.width : column.naturalWidth); });
        node.style.setProperty('--animated-number-content-width', `${width}px`);
    };
    function parkColumns() {
        if (!parked) {
            partNodes.forEach((part, index) => {
                if (index < targetParts.length) part.textContent = targetParts[index].text;
                else {
                    part.remove();
                    partNodes.delete(index);
                }
            });
            parked = true;
        }
        writeContentWidth();
    }
    const unparkColumns = () => {
        if (!parked) return;
        partNodes.forEach((part) => part.replaceChildren());
        describeColumns(targetParts).forEach((descriptor) => {
            const column = columns.get(descriptor.key);
            const part = partNodes.get(descriptor.partIndex);
            if (column && part) part.appendChild(column.node);
        });
        parked = false;
        columns.forEach((column) => {
            measure(column);
            column.width = column.naturalWidth;
            column.widthTarget = column.naturalWidth;
            column.widthVelocity = 0;
            column.widthActive = false;
            writeColumn(column);
        });
    };
    const writeColumn = (column) => {
        if (column.widthActive) column.node.style.width = `${Math.max(0, column.width)}px`;
        else column.node.style.removeProperty('width');
        if (column.kind === 'digit') {
            const offset = modulo(column.position, 10) + 10;
            column.strip.style.transform = `translate3d(0, ${-offset * column.height}px, 0)`;
            column.node.dataset.numberPosition = String(column.position);
            column.node.dataset.numberVelocity = String(column.velocity);
        }
        const widthOpacity = column.kind !== 'sign' && column.exiting && column.naturalWidth > 0
            ? clamp(column.width / column.naturalWidth) : 1;
        column.window.style.opacity = String(widthOpacity * column.signOpacity);
    };
    const removeColumn = (column) => {
        column.node.remove();
        columns.delete(column.key);
    };
    const removeEmptyParts = () => {
        partNodes.forEach((part, index) => {
            if (index >= targetParts.length && !part.childNodes.length) {
                part.remove();
                partNodes.delete(index);
            }
        });
    };
    const settleColumns = () => {
        [...columns.values()].forEach((column) => {
            if (column.exiting) return removeColumn(column);
            column.position = column.kind === 'digit' ? Number(column.targetText) : 0;
            column.targetPosition = column.position;
            column.velocity = 0;
            column.width = column.naturalWidth;
            column.widthVelocity = 0;
            column.widthActive = false;
            column.delay = 0;
            column.signElapsed = null;
            column.signOpacity = 1;
            column.signMode = null;
            column.previousFace?.remove();
            column.previousFace = null;
            if (column.face) {
                column.face.textContent = column.targetText;
                column.face.style.removeProperty('opacity');
            }
            writeColumn(column);
        });
        removeEmptyParts();
        writeContentWidth();
    };
    const jump = () => {
        if (destroyed) return;
        stopFrame();
        settleColumns();
        reducedElapsed = null;
        flashElapsed = null;
        node.style.setProperty('--animated-number-flash-opacity', '0');
        setVisualOpacity(1);
        if (mounted) setState('idle');
    };

    const createColumn = (descriptor) => {
        const element = createSpan('animated-number-column');
        element.dataset.key = descriptor.key;
        element.dataset.numberKind = descriptor.kind;
        element.setAttribute('aria-hidden', 'true');
        const measureNode = createSpan('animated-number-measure');
        measureNode.textContent = descriptor.text;
        const windowNode = createSpan('animated-number-window');
        const glyphs = [];
        let strip = null;
        let face = null;
        if (descriptor.kind === 'digit') {
            strip = createSpan('animated-number-strip');
            for (let index = 0; index < 30; index += 1) {
                const glyph = createSpan('animated-number-glyph');
                glyph.textContent = String(index % 10);
                strip.appendChild(glyph);
                glyphs.push(glyph);
            }
            windowNode.appendChild(strip);
        } else {
            face = createSpan('animated-number-face');
            face.textContent = descriptor.text;
            windowNode.appendChild(face);
        }
        element.appendChild(measureNode);
        element.appendChild(windowNode);
        const column = {
            ...descriptor, node: element, measure: measureNode, window: windowNode,
            strip, face, glyphs, height: 0, naturalWidth: 0,
            position: descriptor.kind === 'digit' ? Number(descriptor.text) : 0,
            targetPosition: descriptor.kind === 'digit' ? Number(descriptor.text) : 0,
            velocity: 0, width: 0, widthVelocity: 0, widthActive: false,
            targetText: descriptor.text, delay: 0, exiting: false,
            signElapsed: null, signOpacity: 1, previousFace: null,
            signMode: null, signStartOpacity: 1, signFaceStart: 1, signPreviousStart: 0,
        };
        columns.set(descriptor.key, column);
        return column;
    };

    const startSignCrossfade = (column, text, added) => {
        const readOpacity = (element) => {
            const opacity = Number.parseFloat(element?.style.opacity);
            return Number.isFinite(opacity) ? opacity : 1;
        };
        if (column.face.textContent !== text) {
            if (column.previousFace?.textContent === text) {
                const previous = column.face;
                column.face = column.previousFace;
                column.previousFace = previous;
                column.face.className = 'animated-number-face';
                column.previousFace.className = 'animated-number-face animated-number-sign-previous';
            } else {
                column.previousFace?.remove();
                column.previousFace = column.face;
                column.previousFace.className = 'animated-number-face animated-number-sign-previous';
                column.face = createSpan('animated-number-face');
                column.face.textContent = text;
                column.face.style.lineHeight = `${column.height}px`;
                column.face.style.opacity = '0';
                column.window.appendChild(column.face);
            }
        }
        if (added) column.face.style.opacity = '0';
        column.signMode = 'crossfade';
        column.signElapsed = 0;
        column.signStartOpacity = column.signOpacity;
        column.signFaceStart = readOpacity(column.face);
        column.signPreviousStart = column.previousFace ? readOpacity(column.previousFace) : 0;
    };

    const reconcile = (nextParts, animate, direction, reduced) => {
        unparkColumns();
        targetParts = nextParts;
        nextParts.forEach((part, index) => {
            let partNode = partNodes.get(index);
            if (!partNode) {
                partNode = createSpan(part.className);
                partNode.dataset.numberPart = String(index);
                partNode.setAttribute('aria-hidden', 'true');
                node.insertBefore(partNode, screenReader);
                partNodes.set(index, partNode);
            } else if (partNode.className !== part.className) partNode.className = part.className;
        });
        const descriptors = describeColumns(nextParts);
        const targetKeys = new Set(descriptors.map((descriptor) => descriptor.key));
        descriptors.forEach((descriptor, index) => {
            let column = columns.get(descriptor.key);
            const added = !column;
            if (!column) {
                column = createColumn(descriptor);
                const nextExisting = descriptors.slice(index + 1).find((entry) => (
                    entry.partIndex === descriptor.partIndex && columns.has(entry.key)
                ));
                partNodes.get(descriptor.partIndex).insertBefore(
                    column.node, nextExisting ? columns.get(nextExisting.key).node : null,
                );
            }
            const previousWidth = column.widthActive ? column.width : column.naturalWidth;
            const changed = column.targetText !== descriptor.text;
            const wasExiting = column.exiting;
            const inFlight = Math.abs(column.position - column.targetPosition) > ANIMATED_NUMBER_TUNING.positionTolerance
                || Math.abs(column.velocity) > ANIMATED_NUMBER_TUNING.velocityTolerance;
            column.exiting = false;
            column.measure.textContent = descriptor.text;
            measure(column);
            column.widthTarget = column.naturalWidth;
            if (animate && !reduced && (added || Math.abs(previousWidth - column.widthTarget) > 0.01)) {
                column.width = added ? 0 : previousWidth;
                column.widthActive = true;
            } else if (!animate || reduced) {
                column.width = column.naturalWidth;
                column.widthVelocity = 0;
                column.widthActive = false;
            }
            if (added && descriptor.kind === 'digit' && animate && !reduced) {
                column.position = Number(descriptor.text) - direction;
                column.targetPosition = Number(descriptor.text);
                column.delay = descriptor.rank * ANIMATED_NUMBER_TUNING.staggerMs;
            } else if (changed && descriptor.kind === 'digit') {
                column.targetPosition = getCyclicDigitTarget(column.position, Number(descriptor.text), direction);
                column.delay = animate && !reduced && !inFlight
                    ? descriptor.rank * ANIMATED_NUMBER_TUNING.staggerMs : 0;
            }
            if ((changed || added || wasExiting) && descriptor.kind === 'sign' && animate && !reduced) {
                startSignCrossfade(column, descriptor.text, added);
            } else if (column.face && (!animate || !reduced) && column.signElapsed === null) {
                column.face.textContent = descriptor.text;
            }
            column.targetText = descriptor.text;
            if (!animate) {
                column.position = descriptor.kind === 'digit' ? Number(descriptor.text) : 0;
                column.targetPosition = column.position;
                column.velocity = 0;
            }
            writeColumn(column);
        });
        [...columns.values()].forEach((column) => {
            if (targetKeys.has(column.key)) return;
            if (!animate || reduced) return removeColumn(column);
            if (!column.exiting) {
                column.width = column.widthActive ? column.width : column.naturalWidth;
                column.widthTarget = 0;
                column.widthActive = true;
                column.exiting = true;
                if (column.kind === 'sign') {
                    column.signMode = 'exit';
                    column.signElapsed = 0;
                    column.signStartOpacity = column.signOpacity;
                }
            }
        });
        removeEmptyParts();
        writeContentWidth();
    };

    const step = (timestamp, schedulerReduced = false) => {
        if (destroyed) return false;
        if (node.isConnected === false && instance.seenConnected) {
            destroy();
            return false;
        }
        if (isHidden()) {
            jump();
            return false;
        }
        const dt = lastTimestamp === null ? 0
            : clamp((timestamp - lastTimestamp) / 1000, 0, ANIMATED_NUMBER_TUNING.maxDeltaSeconds);
        lastTimestamp = timestamp;
        if ((schedulerReduced || mediaQuery?.matches) && reducedElapsed === null) {
            reducedElapsed = 0;
            reducedApplied = false;
            reducedInitialOpacity = visualOpacity;
            flashDuration = Math.min(flashDuration, ANIMATED_NUMBER_TUNING.reducedDurationMs);
            setState('reduced');
        }
        let active = false;
        if (reducedElapsed !== null) {
            reducedElapsed += dt * 1000;
            const progress = clamp(reducedElapsed / ANIMATED_NUMBER_TUNING.reducedDurationMs);
            if (progress >= 0.5 && !reducedApplied) {
                settleColumns();
                reducedApplied = true;
            }
            setVisualOpacity(progress < 0.5
                ? reducedInitialOpacity * (1 - progress * 2) : progress * 2 - 1);
            active = progress < 1;
        } else {
            [...columns.values()].forEach((column) => {
                if (column.delay > 0) {
                    column.delay = Math.max(0, column.delay - dt * 1000);
                    active = true;
                    return;
                }
                if (column.kind === 'digit' && (
                    Math.abs(column.position - column.targetPosition) > ANIMATED_NUMBER_TUNING.positionTolerance
                    || Math.abs(column.velocity) > ANIMATED_NUMBER_TUNING.velocityTolerance
                )) {
                    const next = advanceNumberSpring(column.position, column.velocity, column.targetPosition, dt);
                    column.position = next.position;
                    column.velocity = next.velocity;
                    active = true;
                } else {
                    column.position = column.targetPosition;
                    column.velocity = 0;
                }
                if (column.widthActive) {
                    const next = advanceNumberSpring(column.width, column.widthVelocity, column.widthTarget, dt);
                    column.width = next.position;
                    column.widthVelocity = next.velocity;
                    const settled = Math.abs(column.width - column.widthTarget) < 0.01
                        && Math.abs(column.widthVelocity) < 0.01;
                    if (settled) {
                        column.width = column.widthTarget;
                        column.widthVelocity = 0;
                        column.widthActive = false;
                        if (column.exiting) return removeColumn(column);
                    } else active = true;
                }
                if (column.signElapsed !== null) {
                    column.signElapsed += dt * 1000;
                    const progress = clamp(column.signElapsed / ANIMATED_NUMBER_TUNING.signDurationMs);
                    const exitingSign = column.signMode === 'exit';
                    column.signOpacity = exitingSign
                        ? column.signStartOpacity * (1 - progress)
                        : column.signStartOpacity + (1 - column.signStartOpacity) * progress;
                    if (!exitingSign) {
                        column.face.style.opacity = String(column.signFaceStart + (1 - column.signFaceStart) * progress);
                        if (column.previousFace) column.previousFace.style.opacity = String(column.signPreviousStart * (1 - progress));
                    }
                    if (progress === 1) {
                        column.signElapsed = null;
                        column.previousFace?.remove();
                        column.previousFace = null;
                        column.face.style.removeProperty('opacity');
                        column.signMode = null;
                    }
                    else active = true;
                }
                writeColumn(column);
            });
            removeEmptyParts();
            writeContentWidth();
        }
        if (flashElapsed !== null) {
            flashElapsed += dt * 1000;
            const opacity = 1 - clamp(flashElapsed / flashDuration);
            node.style.setProperty('--animated-number-flash-opacity', String(opacity));
            if (opacity > 0) active = true;
            else flashElapsed = null;
        }
        if (!active) {
            cancelFrame = null;
            lastTimestamp = null;
            reducedElapsed = null;
            setVisualOpacity(1);
            setState('idle');
        }
        return active;
    };

    const remeasure = () => {
        if (destroyed || !mounted) return;
        if (parked) {
            writeContentWidth();
            return;
        }
        columns.forEach((column) => {
            measure(column);
            if (column.widthActive && !column.exiting) column.widthTarget = column.naturalWidth;
            else if (!column.widthActive) column.width = column.naturalWidth;
            writeColumn(column);
        });
        writeContentWidth();
    };

    const update = (value, updateOptions = {}) => {
        if (destroyed) return controller;
        if (typeof updateOptions.format === 'function') formatter = updateOptions.format;
        let nextDisplay;
        try { nextDisplay = String(formatter(value) ?? ''); }
        catch { nextDisplay = String(value ?? ''); }
        if (mounted && nextDisplay === display) {
            lastValue = value;
            lastValid = finiteValue(value) && /[0-9]/.test(nextDisplay);
            if (isHidden() || updateOptions.animate === false) jump();
            else if ([...columns.values()].some((column) => column.height === 0)) remeasure();
            return controller;
        }
        let nextParts;
        try { nextParts = partsFormatter(nextDisplay, value); }
        catch { nextParts = null; }
        if (!Array.isArray(nextParts) || !nextParts.length) nextParts = [{text: nextDisplay, className: ''}];
        nextParts = nextParts.map((part) => ({text: String(part?.text ?? ''), className: String(part?.className || '')}));
        const valid = finiteValue(value) && /[0-9]/.test(nextDisplay);
        const hasLayout = typeof node.getClientRects !== 'function' || node.getClientRects().length > 0;
        const animate = mounted && lastValid && valid && updateOptions.animate !== false
            && !isHidden() && hasLayout && scheduler !== null && node.isConnected !== false;
        const direction = Number(value) >= Number(lastValue) ? 1 : -1;
        const reduced = Boolean(mediaQuery?.matches);
        if (!mounted) {
            const existingLabel = node.getAttribute('aria-label');
            if (existingLabel === nextDisplay || existingLabel === node.textContent?.trim()) node.removeAttribute('aria-label');
            node.replaceChildren();
            screenReader = createSpan('animated-number-sr');
            screenReader.dataset.animatedNumberSr = '';
            node.appendChild(screenReader);
            node.setAttribute('data-animated-number', node.getAttribute('data-animated-number') || '');
            mounted = true;
        }
        screenReader.textContent = nextDisplay;
        display = nextDisplay;
        if (!animate) stopFrame();
        reconcile(nextParts, animate, direction, reduced);
        lastValue = value;
        lastValid = valid;
        if (!animate) {
            jump();
            return controller;
        }
        flashSerial += 1;
        node.dataset.numberFlash = String(flashSerial);
        node.dataset.numberDirection = direction > 0 ? 'up' : 'down';
        node.style.setProperty('--animated-number-flash-opacity', '1');
        flashElapsed = 0;
        flashDuration = reduced ? ANIMATED_NUMBER_TUNING.reducedDurationMs : ANIMATED_NUMBER_TUNING.flashDurationMs;
        reducedElapsed = reduced ? 0 : null;
        reducedApplied = false;
        reducedInitialOpacity = visualOpacity;
        setState(reduced ? 'reduced' : 'running');
        if (!cancelFrame) cancelFrame = scheduler.frame(frameKey, step);
        return controller;
    };
    const destroy = () => {
        if (destroyed) return;
        jump();
        destroyed = true;
        unregister();
    };
    const instance = {node, jump, destroy, remeasure, scheduler, seenConnected: node.isConnected === true};
    const unregister = registerInstance(documentRef, windowRef, instance);
    const controller = Object.freeze({update, destroy, get destroyed() { return destroyed; }});
    if (Object.prototype.hasOwnProperty.call(options, 'value')) update(options.value, {animate: false});
    return controller;
}
