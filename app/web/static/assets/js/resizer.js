/* Code version: v1.2.0 */
(() => {
    const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

    const bind = (handle, options = {}) => {
        if (!(handle instanceof HTMLElement)) return () => {};
        const axis = options.axis === 'block' ? 'block' : 'inline';
        const root = options.root instanceof HTMLElement ? options.root : handle.parentElement;
        const motion = window.WorthwardMotion;
        const velocityTracker = motion?.createVelocityTracker?.();
        let activePointerId = null;
        let latestRawValue = null;
        let dragStartValue = null;
        let cancelVisualFrame = null;
        let visualOffset = 0;
        let visualVelocity = 0;
        const pauseVisual = () => {
            cancelVisualFrame?.();
            cancelVisualFrame = null;
        };
        const clearVisual = () => {
            pauseVisual();
            visualOffset = 0;
            visualVelocity = 0;
            handle.style.removeProperty('--surface-resizer-jelly-offset');
            handle.style.removeProperty('--surface-resizer-jelly-axis-scale');
            handle.style.removeProperty('--surface-resizer-jelly-cross-scale');
        };
        const settleVisual = (releaseVelocity, atBoundary, boundaryDirection) => {
            pauseVisual();
            if (!motion?.springState || !motion?.scheduler?.frame || motion.isReducedMotion()) {
                clearVisual();
                return;
            }
            let impulse = releaseVelocity * (atBoundary ? 0.32 : 0.16);
            if (atBoundary && Math.abs(impulse) < 140) {
                impulse = (Math.abs(releaseVelocity) > 12 ? Math.sign(releaseVelocity) : boundaryDirection) * 140;
            }
            const initialOffset = visualOffset;
            const initialVelocity = clamp(visualVelocity + impulse, -800, 800);
            if (Math.abs(initialOffset) < 0.01 && Math.abs(initialVelocity) < 24) {
                clearVisual();
                return;
            }
            const limit = atBoundary ? 8 : 5;
            const preset = motion.springPresets.bouncy;
            let startedAt = null;
            cancelVisualFrame = motion.scheduler.frame(handle, (now, reduced) => {
                if (startedAt === null) startedAt = now;
                const seconds = Math.max(0, (now - startedAt) / 1000);
                if (reduced || seconds >= preset.duration / 1000 || !handle.isConnected) {
                    clearVisual();
                    return false;
                }
                const displacement = motion.springState(seconds, {
                    from: initialOffset,
                    to: 0,
                    velocity: initialVelocity,
                    mass: preset.mass,
                    stiffness: preset.stiffness,
                    damping: preset.damping,
                });
                const offset = clamp(displacement.position, -limit, limit);
                visualOffset = offset;
                visualVelocity = offset === displacement.position ? displacement.velocity : 0;
                const stretch = Math.min(atBoundary ? 0.12 : 0.07, Math.abs(offset) / 72);
                handle.style.setProperty('--surface-resizer-jelly-offset', `${offset.toFixed(3)}px`);
                handle.style.setProperty('--surface-resizer-jelly-axis-scale', (1 + stretch).toFixed(4));
                handle.style.setProperty('--surface-resizer-jelly-cross-scale', (1 - stretch * 0.5).toFixed(4));
                return true;
            });
        };
        const getRange = () => {
            const range = options.getRange?.() || {};
            const minimum = Number(range.minimum);
            const maximum = Number(range.maximum);
            const safeMinimum = Number.isFinite(minimum) ? minimum : 0;
            return {
                minimum: safeMinimum,
                maximum: Number.isFinite(maximum) ? Math.max(safeMinimum, maximum) : safeMinimum,
            };
        };
        const syncAria = (value = options.getValue?.()) => {
            const range = getRange();
            if (Number.isFinite(range.minimum)) handle.setAttribute('aria-valuemin', String(Math.round(range.minimum)));
            if (Number.isFinite(range.maximum)) handle.setAttribute('aria-valuemax', String(Math.round(range.maximum)));
            if (Number.isFinite(value)) handle.setAttribute('aria-valuenow', String(Math.round(value)));
        };
        const commit = (value, source) => {
            const range = getRange();
            const nextValue = clamp(Number(value) || 0, range.minimum, range.maximum);
            options.setValue?.(nextValue, source);
            syncAria(nextValue);
        };
        const stop = (event) => {
            if (activePointerId === null) return;
            if (Number.isFinite(event?.pointerId) && event.pointerId !== activePointerId) return;
            const released = event?.type === 'pointerup';
            if (released) {
                const position = axis === 'block' ? event.clientY : event.clientX;
                velocityTracker?.sample(position, event.timeStamp);
                latestRawValue = Number(options.valueFromPointer?.(position));
            }
            const releaseVelocity = released ? (velocityTracker?.velocity(event.timeStamp) || 0) : 0;
            const range = getRange();
            const currentValue = Number(options.getValue?.());
            const belowMinimum = Number.isFinite(latestRawValue) && latestRawValue < range.minimum;
            const aboveMaximum = Number.isFinite(latestRawValue) && latestRawValue > range.maximum;
            const atMinimum = currentValue <= range.minimum + 0.5;
            const atMaximum = currentValue >= range.maximum - 0.5;
            const atBoundary = belowMinimum || aboveMaximum
                || (atMinimum && releaseVelocity < -20)
                || (atMaximum && releaseVelocity > 20);
            const boundaryDirection = belowMinimum || (atMinimum && !aboveMaximum) ? -1 : 1;
            handle.classList.remove('is-resizing');
            root?.classList.remove('is-surface-resizing');
            const pointerId = activePointerId;
            activePointerId = null;
            if (typeof handle.releasePointerCapture === 'function') {
                try {
                    handle.releasePointerCapture(pointerId);
                } catch (_error) {
                }
            }
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', stop);
            window.removeEventListener('pointercancel', stop);
            window.removeEventListener('blur', stop);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            velocityTracker?.reset();
            if (!released && Number.isFinite(dragStartValue)) commit(dragStartValue, 'pointer-cancel');
            dragStartValue = null;
            options.onEnd?.();
            if (released) settleVisual(releaseVelocity, atBoundary, boundaryDirection);
            else clearVisual();
        };
        const onPointerMove = (event) => {
            if (event.pointerId !== activePointerId) return;
            const clientPosition = axis === 'block' ? event.clientY : event.clientX;
            latestRawValue = Number(options.valueFromPointer?.(clientPosition));
            velocityTracker?.sample(clientPosition, event.timeStamp);
            commit(latestRawValue, 'pointer');
        };
        const onPointerDown = (event) => {
            if (event.button !== 0 || activePointerId !== null) return;
            event.preventDefault();
            pauseVisual();
            velocityTracker?.reset();
            dragStartValue = Number(options.getValue?.());
            activePointerId = typeof event.pointerId === 'number' ? event.pointerId : null;
            if (activePointerId !== null && typeof handle.setPointerCapture === 'function') {
                try {
                    handle.setPointerCapture(activePointerId);
                } catch (_error) {
                }
            }
            handle.classList.add('is-resizing');
            root?.classList.add('is-surface-resizing');
            options.onStart?.();
            onPointerMove(event);
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', stop);
            window.addEventListener('pointercancel', stop);
            window.addEventListener('blur', stop);
            document.addEventListener('visibilitychange', onVisibilityChange);
        };
        const onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') stop();
        };
        const onLostPointerCapture = (event) => {
            if (event.pointerId === activePointerId) stop();
        };
        const onKeyDown = (event) => {
            const decrementKey = axis === 'block' ? 'ArrowUp' : 'ArrowLeft';
            const incrementKey = axis === 'block' ? 'ArrowDown' : 'ArrowRight';
            const range = getRange();
            const currentValue = Number(options.getValue?.());
            const step = event.shiftKey ? Number(options.largeStep || 48) : Number(options.step || 16);
            let nextValue = null;
            if (event.key === decrementKey) nextValue = currentValue - step;
            if (event.key === incrementKey) nextValue = currentValue + step;
            if (event.key === 'Home') nextValue = range.minimum;
            if (event.key === 'End') nextValue = range.maximum;
            if (!Number.isFinite(nextValue)) return;
            event.preventDefault();
            commit(nextValue, 'keyboard');
        };
        handle.addEventListener('pointerdown', onPointerDown);
        handle.addEventListener('lostpointercapture', onLostPointerCapture);
        handle.addEventListener('keydown', onKeyDown);
        syncAria();
        return () => {
            stop();
            clearVisual();
            handle.removeEventListener('pointerdown', onPointerDown);
            handle.removeEventListener('lostpointercapture', onLostPointerCapture);
            handle.removeEventListener('keydown', onKeyDown);
        };
    };

    window.WORTHWARD_RESIZER = Object.freeze({bind});
})();
