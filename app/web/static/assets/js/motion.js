/* Code version: v1.1.0 */
(() => {
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));
    const durations = Object.freeze({instant: 100, fast: 160, standard: 240, emphasized: 420, spatial: 560});
    const easingTokens = Object.freeze({
        standard: "cubic-bezier(0.2, 0, 0, 1)",
        emphasized: "cubic-bezier(0.16, 1, 0.3, 1)",
    });
    const springPresets = Object.freeze({
        standard: Object.freeze({mass: 1, stiffness: 170, damping: 26, initialVelocity: 0, duration: 560}),
        emphasized: Object.freeze({mass: 1, stiffness: 190, damping: 24, initialVelocity: 0, duration: 560}),
        bouncy: Object.freeze({mass: 1, stiffness: 180, damping: 18, initialVelocity: 0, duration: 620}),
    });

    const isReducedMotion = () => Boolean(reducedMotionQuery.matches);

    const easing = Object.freeze({
        linear: (progress) => clamp(progress),
        standard: (progress) => 1 - Math.pow(1 - clamp(progress), 3),
        emphasized: (progress) => 1 - Math.pow(1 - clamp(progress), 4),
        inOut: (progress) => {
            const value = clamp(progress);
            return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
        },
        spring: (progress, parameters = springPresets.standard) => {
            const value = clamp(progress);
            if (value === 0 || value === 1) return value;
            const mass = Math.max(0.001, Number(parameters.mass) || springPresets.standard.mass);
            const stiffness = Math.max(0.001, Number(parameters.stiffness) || springPresets.standard.stiffness);
            const damping = Math.max(0, Number(parameters.damping) || springPresets.standard.damping);
            const initialVelocity = Number(parameters.initialVelocity) || 0;
            const duration = Math.max(1, Number(parameters.duration) || springPresets.standard.duration);
            const angularFrequency = Math.sqrt(stiffness / mass);
            const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));
            const time = value * (duration / 1000);

            if (dampingRatio < 1) {
                const dampedFrequency = angularFrequency * Math.sqrt(1 - (dampingRatio * dampingRatio));
                const displacement = -1;
                const velocity = (initialVelocity + (dampingRatio * angularFrequency)) / dampedFrequency;
                const envelope = Math.exp(-dampingRatio * angularFrequency * time);
                return clamp(1 + (envelope * (
                    (displacement * Math.cos(dampedFrequency * time))
                    + (velocity * Math.sin(dampedFrequency * time))
                )), -0.25, 1.25);
            }

            const envelope = Math.exp(-angularFrequency * time);
            return clamp(1 - envelope * (1 + ((angularFrequency - initialVelocity) * time)), -0.25, 1.25);
        },
    });

    function createScheduler() {
        const frameTasks = new Map();
        const readWriteTasks = new Map();
        let frameId = 0;

        const requestFlush = () => {
            if (frameId) return;
            frameId = window.requestAnimationFrame(flush);
        };

        const cancel = (key) => {
            frameTasks.delete(key);
            readWriteTasks.delete(key);
            if (!frameTasks.size && !readWriteTasks.size && frameId) {
                window.cancelAnimationFrame(frameId);
                frameId = 0;
            }
        };

        function flush(now) {
            frameId = 0;
            const readWriteBatch = Array.from(readWriteTasks.entries());
            readWriteTasks.clear();
            const readResults = new Map();

            readWriteBatch.forEach(([key, task]) => {
                readResults.set(key, task.read ? task.read(now) : undefined);
            });
            readWriteBatch.forEach(([key, task]) => {
                task.write?.(readResults.get(key), now);
            });

            Array.from(frameTasks.entries()).forEach(([key, task]) => {
                if (frameTasks.get(key) !== task) return;
                const keepAlive = task.step(now, isReducedMotion());
                if (!keepAlive) frameTasks.delete(key);
            });

            if (frameTasks.size || readWriteTasks.size) requestFlush();
        }

        const scheduleReadWrite = (key, read, write) => {
            const taskKey = key ?? Symbol("motion-read-write");
            readWriteTasks.set(taskKey, {read, write});
            requestFlush();
            return () => {
                if (readWriteTasks.get(taskKey)) readWriteTasks.delete(taskKey);
                if (!frameTasks.size && !readWriteTasks.size && frameId) {
                    window.cancelAnimationFrame(frameId);
                    frameId = 0;
                }
            };
        };

        const scheduleFrame = (key, step) => {
            const taskKey = key ?? Symbol("motion-frame");
            frameTasks.set(taskKey, {step});
            requestFlush();
            return () => cancel(taskKey);
        };

        const animate = ({
            key,
            duration = durations.standard,
            ease = easing.emphasized,
            update,
            complete,
            signal,
        } = {}) => {
            const taskKey = key ?? Symbol("motion-animation");
            let startedAt = null;
            return scheduleFrame(taskKey, (now, reduced) => {
                if (signal?.aborted) return false;
                if (startedAt === null) startedAt = now;
                const progress = reduced ? 1 : clamp((now - startedAt) / Math.max(1, duration));
                update?.(ease(progress), progress, now);
                if (progress >= 1) {
                    complete?.();
                    return false;
                }
                return true;
            });
        };

        return Object.freeze({
            animate,
            cancel,
            frame: scheduleFrame,
            readWrite: scheduleReadWrite,
            get activeCount() {
                return frameTasks.size + readWriteTasks.size;
            },
        });
    }

    const scheduler = createScheduler();

    const tween = (options = {}) => scheduler.animate(options);

    const animate = (element, keyframes, options = {}) => {
        if (!(element instanceof Element) || typeof element.animate !== "function") return null;
        const resolvedOptions = {...options};
        if (isReducedMotion()) {
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

    const flip = (elements, mutate, options = {}) => {
        const list = (Array.isArray(elements) ? elements : [elements]).filter(
            (element) => element instanceof Element,
        );
        if (!list.length) {
            mutate?.();
            return () => {};
        }
        const firstRects = list.map((element) => element.getBoundingClientRect());
        mutate?.();
        const lastRects = list.map((element) => element.getBoundingClientRect());
        const animations = list.map((element, index) => {
            const first = firstRects[index];
            const last = lastRects[index];
            const deltaX = first.left - last.left;
            const deltaY = first.top - last.top;
            const scaleX = last.width ? first.width / last.width : 1;
            const scaleY = last.height ? first.height / last.height : 1;
            if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5
                && Math.abs(scaleX - 1) < 0.001 && Math.abs(scaleY - 1) < 0.001) return null;
            const existingTransform = getComputedStyle(element).transform;
            const finalTransform = existingTransform === "none" ? "none" : existingTransform;
            const invertedTransform = `translate3d(${deltaX.toFixed(2)}px, ${deltaY.toFixed(2)}px, 0) scale(${scaleX}, ${scaleY})${finalTransform === "none" ? "" : ` ${finalTransform}`}`;
            return animate(element, [
                {transform: invertedTransform},
                {transform: finalTransform},
            ], {
                duration: options.duration ?? durations.standard,
                easing: options.easing ?? easingTokens.emphasized,
                fill: "both",
                signal: options.signal,
            });
        });
        return () => animations.forEach((animation) => animation?.cancel());
    };

    window.WorthwardMotion = Object.freeze({
        animate,
        clamp,
        durations,
        easingTokens,
        easing,
        flip,
        isReducedMotion,
        reducedMotionQuery,
        scheduler,
        springPresets,
        tween,
    });
})();
