/* Code version: v1.4.0 */
(() => {
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));
    const durations = Object.freeze({instant: 100, fast: 160, standard: 240, emphasized: 420, spatial: 560});
    const springCurve = "linear(0, .02939, .10213, .19948, .30771, .41717, .52142, .61651, .70032, .77209, .83197, .88071, .91942, .94939, .97195, .98837, .99984, 1.00742, 1.01201, 1.01438, 1.01515, 1.01483, 1.01380, 1.01236, 1.01074, 1.00907, 1.00748, 1.00601, 1.00471, 1.00360, 1.00267, 1.00190, 1)";
    const boundedSpringSamples = springCurve.slice("linear(".length, -1)
        .split(",")
        .map((sample) => clamp(Number(sample)));
    const easingTokens = Object.freeze({
        standard: springCurve,
        emphasized: springCurve,
        spring: springCurve,
        boundedSpring: `linear(${boundedSpringSamples.join(", ")})`,
    });
    const springPreset = (duration) => {
        const mass = 1;
        const stiffness = 180 * Math.pow(620 / duration, 2);
        return Object.freeze({
            mass,
            stiffness,
            damping: 2 * 0.8 * Math.sqrt(stiffness * mass),
            initialVelocity: 0,
            duration,
        });
    };
    const springPresets = Object.freeze({
        standard: springPreset(560),
        emphasized: springPreset(560),
        bouncy: springPreset(620),
    });

    const isReducedMotion = () => Boolean(reducedMotionQuery.matches);

    const springState = (elapsedSeconds, parameters = {}) => {
        const from = Number.isFinite(parameters.from) ? parameters.from : 0;
        const to = Number.isFinite(parameters.to) ? parameters.to : 1;
        const velocity = Number.isFinite(parameters.velocity) ? parameters.velocity : 0;
        const mass = Math.max(0.001, Number(parameters.mass) || 1);
        const stiffness = Math.max(0.001, Number(parameters.stiffness) || 180);
        const damping = Number.isFinite(parameters.damping)
            ? Math.max(0, parameters.damping)
            : 2 * 0.8 * Math.sqrt(stiffness * mass);
        const time = Math.max(0, Number(elapsedSeconds) || 0);
        const frequency = Math.sqrt(stiffness / mass);
        const ratio = damping / (2 * Math.sqrt(stiffness * mass));
        const displacement = from - to;
        if (ratio < 1) {
            const decay = ratio * frequency;
            const oscillation = frequency * Math.sqrt(1 - ratio * ratio);
            const sineWeight = (velocity + decay * displacement) / oscillation;
            const cosine = Math.cos(oscillation * time);
            const sine = Math.sin(oscillation * time);
            const envelope = Math.exp(-decay * time);
            const shape = displacement * cosine + sineWeight * sine;
            return {
                position: to + envelope * shape,
                velocity: envelope * (
                    -decay * shape + oscillation * (-displacement * sine + sineWeight * cosine)
                ),
            };
        }
        if (Math.abs(ratio - 1) < 1e-6) {
            const linearWeight = velocity + frequency * displacement;
            const envelope = Math.exp(-frequency * time);
            const shape = displacement + linearWeight * time;
            return {
                position: to + envelope * shape,
                velocity: envelope * (linearWeight - frequency * shape),
            };
        }
        const root = Math.sqrt(ratio * ratio - 1);
        const firstRate = -frequency * (ratio - root);
        const secondRate = -frequency * (ratio + root);
        const firstWeight = (velocity - secondRate * displacement) / (firstRate - secondRate);
        const secondWeight = displacement - firstWeight;
        const first = firstWeight * Math.exp(firstRate * time);
        const second = secondWeight * Math.exp(secondRate * time);
        return {
            position: to + first + second,
            velocity: firstRate * first + secondRate * second,
        };
    };

    const createVelocityTracker = ({windowMs = 80, maxVelocity = 2400} = {}) => {
        const samples = [];
        const sample = (position, timestamp) => {
            if (!Number.isFinite(position) || !Number.isFinite(timestamp)) return;
            if (samples.length && timestamp < samples[samples.length - 1].timestamp) samples.length = 0;
            samples.push({position, timestamp});
            while (samples.length > 2 && samples[1].timestamp < timestamp - windowMs) samples.shift();
        };
        const velocity = (timestamp = samples[samples.length - 1]?.timestamp) => {
            const last = samples[samples.length - 1];
            if (!last || !Number.isFinite(timestamp) || timestamp - last.timestamp > windowMs) return 0;
            const first = samples.find((entry) => last.timestamp - entry.timestamp <= windowMs) || last;
            const seconds = (last.timestamp - first.timestamp) / 1000;
            if (seconds < 0.004) return 0;
            return clamp((last.position - first.position) / seconds, -maxVelocity, maxVelocity);
        };
        return Object.freeze({sample, velocity, reset: () => { samples.length = 0; }});
    };

    const springEase = (progress, parameters = springPresets.standard) => {
        const value = clamp(progress);
        if (value === 0 || value === 1) return value;
        const duration = Math.max(1, Number(parameters.duration) || springPresets.standard.duration);
        return clamp(springState(value * duration / 1000, {
            from: 0,
            to: 1,
            velocity: Number(parameters.initialVelocity) || 0,
            mass: parameters.mass,
            stiffness: parameters.stiffness,
            damping: parameters.damping,
        }).position, -0.25, 1.25);
    };

    const easing = Object.freeze({
        linear: (progress) => clamp(progress),
        standard: (progress) => springEase(progress, springPresets.standard),
        emphasized: (progress) => springEase(progress, springPresets.emphasized),
        inOut: (progress) => springEase(progress, springPresets.standard),
        spring: springEase,
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
        createVelocityTracker,
        durations,
        easingTokens,
        easing,
        flip,
        isReducedMotion,
        reducedMotionQuery,
        scheduler,
        springState,
        springPresets,
        tween,
    });
})();

(() => {
    const motion = window.WorthwardMotion;
    if (!motion || typeof document === "undefined") return;
    const animations = new Map();

    const stop = (details) => {
        animations.get(details)?.cancel();
        animations.delete(details);
    };

    // Native toggles preserve keyboard activation and named accordion behavior.
    document.addEventListener("toggle", (event) => {
        const details = event.target;
        if (!(details instanceof HTMLDetailsElement) || !details.matches(".ui-collapse")) return;
        stop(details);
        if (!details.open || motion.isReducedMotion()) return;
        const summary = details.querySelector(":scope > summary");
        if (!summary || typeof details.animate !== "function") return;
        const style = getComputedStyle(details);
        const inset = ["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"]
            .reduce((sum, key) => sum + (parseFloat(style[key]) || 0), 0);
        const expanded = details.getBoundingClientRect().height;
        const collapsed = summary.getBoundingClientRect().height + inset;
        const adjustment = style.boxSizing === "border-box" ? 0 : inset;
        const preset = motion.springPresets.bouncy;
        const frames = Array.from({length: 41}, (_, index) => {
            const progress = index / 40;
            const height = collapsed + (expanded - collapsed) * motion.easing.spring(progress, preset);
            return {height: `${Math.max(0, height - adjustment)}px`, overflow: "clip", offset: progress};
        });
        const animation = details.animate(frames, {duration: preset.duration, easing: "linear"});
        animations.set(details, animation);
        animation.finished.catch(() => {}).finally(() => {
            if (animations.get(details) === animation) animations.delete(details);
        });
    }, true);

    motion.reducedMotionQuery.addEventListener("change", () => {
        if (motion.isReducedMotion()) [...animations.keys()].forEach(stop);
    });
})();
