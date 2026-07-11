/* Code version: v1.0.0 */
(() => {
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));
    const easing = Object.freeze({
        linear: (progress) => clamp(progress),
        standard: (progress) => 1 - Math.pow(1 - clamp(progress), 3),
        emphasized: (progress) => 1 - Math.pow(1 - clamp(progress), 4),
        inOut: (progress) => {
            const value = clamp(progress);
            return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
        },
        spring: (progress) => {
            const value = clamp(progress);
            if (value === 0 || value === 1) return value;
            return 1 + Math.pow(2, -10 * value) * Math.sin((value * 10 - 0.75) * (2 * Math.PI / 3));
        },
    });
    const durations = Object.freeze({instant: 100, fast: 160, standard: 240, emphasized: 420, spatial: 560});

    const tween = ({duration = durations.standard, ease = easing.emphasized, update, complete, signal} = {}) => {
        let frameId = 0;
        let settled = false;
        const startedAt = performance.now();
        const finish = (cancelled = false) => {
            if (settled) return;
            settled = true;
            if (frameId) window.cancelAnimationFrame(frameId);
            if (!cancelled) complete?.();
        };
        const step = (now) => {
            if (signal?.aborted) {
                finish(true);
                return;
            }
            const progress = reducedMotionQuery.matches ? 1 : clamp((now - startedAt) / Math.max(1, duration));
            update?.(ease(progress), progress);
            if (progress < 1) frameId = window.requestAnimationFrame(step);
            else finish();
        };
        frameId = window.requestAnimationFrame(step);
        return () => finish(true);
    };

    const animate = (element, keyframes, options = {}) => {
        if (!(element instanceof Element) || typeof element.animate !== "function") return null;
        const resolvedOptions = {...options};
        if (reducedMotionQuery.matches) {
            resolvedOptions.delay = 0;
            resolvedOptions.duration = 1;
            resolvedOptions.iterations = 1;
        }
        element.dataset.motionState = "running";
        const animation = element.animate(keyframes, resolvedOptions);
        animation.finished.catch(() => {}).finally(() => {
            if (element.dataset.motionState === "running") delete element.dataset.motionState;
        });
        return animation;
    };

    window.AntigravityMotion = Object.freeze({animate, clamp, durations, easing, reducedMotionQuery, tween});
})();
