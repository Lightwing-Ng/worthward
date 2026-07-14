/* Code version: v1.0.0 */
(() => {
    const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

    const bind = (handle, options = {}) => {
        if (!(handle instanceof HTMLElement)) return () => {};
        const axis = options.axis === 'block' ? 'block' : 'inline';
        const root = options.root instanceof HTMLElement ? options.root : handle.parentElement;
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
        const stop = () => {
            handle.classList.remove('is-resizing');
            root?.classList.remove('is-surface-resizing');
            if (activePointerId !== null && typeof handle.releasePointerCapture === 'function') {
                try {
                    handle.releasePointerCapture(activePointerId);
                } catch (_error) {
                }
            }
            activePointerId = null;
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', stop);
            window.removeEventListener('pointercancel', stop);
            options.onEnd?.();
        };
        const onPointerMove = (event) => {
            const clientPosition = axis === 'block' ? event.clientY : event.clientX;
            commit(options.valueFromPointer?.(clientPosition), 'pointer');
        };
        const onPointerDown = (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
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
        let activePointerId = null;
        handle.addEventListener('pointerdown', onPointerDown);
        handle.addEventListener('keydown', onKeyDown);
        syncAria();
        return () => {
            stop();
            handle.removeEventListener('pointerdown', onPointerDown);
            handle.removeEventListener('keydown', onKeyDown);
        };
    };

    window.ANTIGRAVITY_RESIZER = Object.freeze({bind});
})();
