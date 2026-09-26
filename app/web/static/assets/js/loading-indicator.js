/* Code version: v1.0.0 */
(function (globalScope) {
    "use strict";

    if (globalScope.WORTHWARD_LOADING_INDICATOR?.version === "v1.0.0") return;

    const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
    const CENTER = 12;
    const RADIUS = 8.75;
    const STROKE_WIDTH = 2.25;
    const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
    const REFERENCE_PROGRESS = 75;
    const REFERENCE_ARC_LENGTH = 39;
    const CAP_LENGTH = 2 * RADIUS * Math.asin(STROKE_WIDTH / (2 * RADIUS));
    const ACCESSIBLE_ATTRIBUTES = [
        "role", "aria-hidden", "aria-label", "aria-valuemin", "aria-valuemax",
        "aria-valuenow", "aria-valuetext",
    ];
    const states = new WeakMap();

    function svgElement(document, name, attributes) {
        const element = document.createElementNS(SVG_NAMESPACE, name);
        Object.entries(attributes).forEach(([key, value]) =>
            element.setAttribute(key, String(value)));
        return element;
    }

    function createState(element) {
        const document = element.ownerDocument;
        const svg = svgElement(document, "svg", {
            viewBox: "0 0 24 24",
            "shape-rendering": "geometricPrecision",
            "aria-hidden": "true",
            focusable: "false",
            "data-loading-indicator-svg": "",
        });
        const circleAttributes = {
            cx: CENTER,
            cy: CENTER,
            r: RADIUS,
            fill: "none",
            stroke: "currentColor",
            "stroke-width": STROKE_WIDTH,
        };
        const track = svgElement(document, "circle", {
            ...circleAttributes,
            opacity: 0.26,
            "data-loading-track": "",
        });
        const arc = svgElement(document, "circle", {
            ...circleAttributes,
            "stroke-linecap": "round",
            transform: `rotate(-90 ${CENTER} ${CENTER})`,
            "data-loading-arc": "",
        });
        const dot = svgElement(document, "circle", {
            cx: CENTER,
            cy: CENTER - RADIUS,
            r: STROKE_WIDTH / 2,
            fill: "currentColor",
            "data-loading-dot": "",
        });
        svg.appendChild(track);
        svg.appendChild(arc);
        svg.appendChild(dot);
        return {
            svg,
            arc,
            dot,
            originalAttributes: new Map(ACCESSIBLE_ATTRIBUTES.map((name) =>
                [name, element.getAttribute(name)])),
        };
    }

    function arcLength(progress) {
        // Round caps have a visible angular footprint. Interpolate from that
        // exact dot footprint, through the original 39-unit arc at 75%, to the
        // point where the caps meet. At 100% an undashed circle removes the seam.
        // This calibration preserves the approved SVG instead of claiming that
        // its rounded 39-unit centerline is exactly 75% of the circumference.
        if (progress <= REFERENCE_PROGRESS) {
            return REFERENCE_ARC_LENGTH * progress / REFERENCE_PROGRESS;
        }
        return REFERENCE_ARC_LENGTH
            + (CIRCUMFERENCE - CAP_LENGTH - REFERENCE_ARC_LENGTH)
                * (progress - REFERENCE_PROGRESS) / (100 - REFERENCE_PROGRESS);
    }

    // Call on the shared .suggestion-loading-spinner element. This renderer
    // accepts measured percentages only; consumers own task totals and updates.
    function setProgress(element, options = {}) {
        if (!element?.ownerDocument || typeof element.setAttribute !== "function") {
            return null;
        }
        const {determinate = false, value = 0, label = "Loading"} = options || {};
        if (determinate !== true) {
            const state = states.get(element);
            if (state) {
                state.svg.remove();
                state.originalAttributes.forEach((original, name) => {
                    if (original === null) element.removeAttribute(name);
                    else element.setAttribute(name, original);
                });
                states.delete(element);
            }
            element.setAttribute("data-loading-determinate", "false");
            element.removeAttribute("data-loading-progress");
            return null;
        }

        const progress = typeof value === "number" && Number.isFinite(value)
            ? Math.min(100, Math.max(0, value)) : 0;
        let state = states.get(element);
        if (!state) {
            state = createState(element);
            states.set(element, state);
        }
        if (state.svg.parentNode !== element) element.appendChild(state.svg);
        element.setAttribute("data-loading-determinate", "true");
        element.setAttribute("data-loading-progress", String(progress));
        element.setAttribute("role", "progressbar");
        element.removeAttribute("aria-hidden");
        element.setAttribute("aria-label", typeof label === "string" && label.trim()
            ? label.trim() : "Loading");
        element.setAttribute("aria-valuemin", "0");
        element.setAttribute("aria-valuemax", "100");
        element.setAttribute("aria-valuenow", String(progress));
        element.setAttribute("aria-valuetext", `${progress}%`);
        state.dot.setAttribute("display", progress === 0 ? "inline" : "none");
        state.arc.setAttribute("display", progress === 0 ? "none" : "inline");
        if (progress === 100) {
            state.arc.removeAttribute("stroke-dasharray");
        } else if (progress === REFERENCE_PROGRESS) {
            state.arc.setAttribute("stroke-dasharray", "39 16");
        } else {
            const length = arcLength(progress);
            state.arc.setAttribute("stroke-dasharray", `${length} ${CIRCUMFERENCE - length}`);
        }
        return progress;
    }

    globalScope.WORTHWARD_LOADING_INDICATOR = Object.freeze({
        version: "v1.0.0",
        setProgress,
    });
})(typeof window === "undefined" ? globalThis : window);
