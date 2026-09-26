/* Code version: v1.0.0 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL(
    "../app/web/static/assets/js/loading-indicator.js", import.meta.url), "utf8");
const approvedSvg = readFileSync(new URL(
    "../app/web/static/images/loading.spinner.svg", import.meta.url), "utf8");

function fixture(initialAttributes = {}) {
    const context = {
        setTimeout() {throw new Error("Progress cannot advance on a timer");},
        setInterval() {throw new Error("Progress cannot advance on a timer");},
        requestAnimationFrame() {throw new Error("Progress cannot advance on a frame");},
    };
    vm.runInNewContext(source, context);
    const document = {createElementNS(namespace, name) {return element(name, namespace);}};
    function element(name, namespace = null) {
        const attributes = new Map();
        return {
            nodeName: name, namespaceURI: namespace, ownerDocument: document,
            attributes, children: [], parentNode: null,
            setAttribute(key, value) {attributes.set(key, String(value));},
            getAttribute(key) {return attributes.get(key) ?? null;},
            removeAttribute(key) {attributes.delete(key);},
            appendChild(child) {
                child.remove();
                this.children.push(child);
                child.parentNode = this;
            },
            remove() {
                if (!this.parentNode) return;
                const siblings = this.parentNode.children;
                siblings.splice(siblings.indexOf(this), 1);
                this.parentNode = null;
            },
        };
    }
    const spinner = element("span");
    Object.entries(initialAttributes).forEach(([key, value]) => spinner.setAttribute(key, value));
    const api = context.WORTHWARD_LOADING_INDICATOR;
    return {
        spinner, api, element,
        reload() {vm.runInNewContext(source, context); return context.WORTHWARD_LOADING_INDICATOR;},
        update(value, options = {}) {
            return api.setProgress(spinner, {determinate: true, value, ...options});
        },
        get svg() {return spinner.children.find(child =>
            child.getAttribute("data-loading-indicator-svg") !== null);},
        get arc() {return this.svg.children[1];},
        get dot() {return this.svg.children[2];},
    };
}

test("default and strict-false modes retain the original indicator and authored accessibility", () => {
    const f = fixture({"aria-hidden": "true", "class": "suggestion-loading-spinner"});
    for (const determinate of [undefined, false, 0, 1, "true", {}, null]) {
        f.api.setProgress(f.spinner, {determinate, value: 75});
        assert.equal(f.spinner.getAttribute("data-loading-determinate"), "false");
        assert.equal(f.spinner.getAttribute("data-loading-progress"), null);
        assert.equal(f.spinner.getAttribute("aria-hidden"), "true");
        assert.equal(f.spinner.getAttribute("class"), "suggestion-loading-spinner");
        assert.equal(f.spinner.children.length, 0);
    }
    assert.equal(f.api.version, "v1.0.0");
    assert.ok(Object.isFrozen(f.api));
});

test("0% starts with an exact circular dot at twelve o'clock", () => {
    const f = fixture({"aria-hidden": "true"});
    f.update(0, {label: "Loading holdings"});
    assert.equal(f.svg.namespaceURI, "http://www.w3.org/2000/svg");
    assert.equal(f.svg.getAttribute("viewBox"), "0 0 24 24");
    assert.equal(f.svg.getAttribute("aria-hidden"), "true");
    assert.equal(f.dot.nodeName, "circle");
    assert.equal(f.dot.getAttribute("cx"), "12");
    assert.equal(f.dot.getAttribute("cy"), "3.25");
    assert.equal(f.dot.getAttribute("r"), "1.125");
    assert.equal(f.dot.getAttribute("display"), "inline");
    assert.equal(f.arc.getAttribute("display"), "none");
    assert.equal(f.spinner.getAttribute("aria-hidden"), null);
    assert.equal(f.spinner.getAttribute("role"), "progressbar");
    assert.equal(f.spinner.getAttribute("aria-label"), "Loading holdings");
    assert.equal(f.spinner.getAttribute("aria-valuemin"), "0");
    assert.equal(f.spinner.getAttribute("aria-valuemax"), "100");
    assert.equal(f.spinner.getAttribute("aria-valuenow"), "0");
});

test("75% retains the exact approved SVG track and foreground geometry", () => {
    const f = fixture();
    f.update(75);
    const approvedCircles = Array.from(approvedSvg.matchAll(/<circle\s+([\s\S]*?)\/>/g), match =>
        new Map(Array.from(match[1].matchAll(/([\w-]+)="([^"]*)"/g), attr => [attr[1], attr[2]])));
    assert.equal(approvedCircles.length, 2);
    for (const index of [0, 1]) {
        for (const [key, value] of approvedCircles[index]) {
            assert.equal(f.svg.children[index].getAttribute(key), key === "stroke" ? "currentColor" : value);
        }
    }
    assert.equal(f.dot.getAttribute("display"), "none");
    assert.equal(f.arc.getAttribute("display"), "inline");
    assert.equal(f.spinner.getAttribute("data-loading-progress"), "75");
    assert.equal(f.spinner.getAttribute("aria-valuenow"), "75");
    assert.equal(f.spinner.getAttribute("aria-valuetext"), "75%");
});

test("100% is one undashed full circle without an endpoint seam", () => {
    const f = fixture();
    f.update(75);
    f.update(100);
    assert.equal(f.arc.getAttribute("stroke-dasharray"), null);
    assert.equal(f.arc.getAttribute("display"), "inline");
    assert.equal(f.dot.getAttribute("display"), "none");
    assert.equal(f.spinner.getAttribute("aria-valuenow"), "100");
});

test("every measured increment grows immediately and retains a gap until completion", () => {
    const f = fixture();
    const radius = 8.75;
    const circumference = 2 * Math.PI * radius;
    const capFootprint = 2 * radius * Math.asin(2.25 / (2 * radius));
    let previous = 0;
    for (const value of [0.0001, 1, 10, 25, 50, 74.9999, 75, 75.0001, 90, 99, 99.9999]) {
        f.update(value);
        const [length, gap] = f.arc.getAttribute("stroke-dasharray").split(" ").map(Number);
        assert.ok(length > previous, `${value}% must grow`);
        assert.ok(length + capFootprint < circumference, `${value}% must not be a complete circle`);
        assert.ok(gap > capFootprint);
        assert.equal(f.spinner.getAttribute("aria-valuenow"), String(value));
        previous = length;
    }
    assert.ok(circumference - capFootprint - previous < 0.0001,
        "Near-complete caps must converge continuously on a complete circle");
});

test("invalid values fail safely and out-of-range numeric values clamp", () => {
    const f = fixture();
    for (const value of [undefined, null, "75", NaN, Infinity, -Infinity, {}, [], true, -10]) {
        assert.equal(f.update(value), 0);
        assert.equal(f.spinner.getAttribute("aria-valuenow"), "0");
    }
    assert.equal(f.update(120), 100);
    assert.equal(f.update(12.5), 12.5);
    assert.equal(f.spinner.getAttribute("aria-valuetext"), "12.5%");
    assert.equal(f.api.setProgress(null, {determinate: true, value: 50}), null);
    assert.equal(f.api.setProgress({}), null);
});

test("updates reuse one SVG and resetting permits a lower measured value", () => {
    const f = fixture();
    f.update(50);
    const svg = f.svg;
    const arc = f.arc;
    f.update(90);
    f.update(10);
    assert.equal(f.spinner.children.length, 1);
    assert.equal(f.svg, svg);
    assert.equal(f.arc, arc);
    assert.equal(f.spinner.getAttribute("aria-valuenow"), "10");
    svg.remove();
    f.update(20);
    assert.equal(f.svg, svg);
});

test("classic-script and module fallback loads share one live renderer", () => {
    const f = fixture();
    f.update(25);
    const svg = f.svg;
    const reloaded = f.reload();
    assert.equal(reloaded, f.api);
    reloaded.setProgress(f.spinner, {determinate: true, value: 50});
    assert.equal(f.svg, svg);
    assert.equal(f.spinner.children.length, 1);
    reloaded.setProgress(f.spinner, {determinate: false});
    assert.equal(f.spinner.children.length, 0);
});

test("switching to false restores original ARIA and preserves unrelated children", () => {
    const original = {role: "status", "aria-label": "Waiting", "aria-hidden": "true"};
    const f = fixture(original);
    const child = f.element("span");
    f.spinner.appendChild(child);
    f.update(25);
    f.api.setProgress(f.spinner);
    assert.deepEqual(f.spinner.children, [child]);
    for (const [key, value] of Object.entries(original)) assert.equal(f.spinner.getAttribute(key), value);
    for (const attr of ["aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-valuetext", "data-loading-progress"]) {
        assert.equal(f.spinner.getAttribute(attr), null);
    }
    f.spinner.setAttribute("aria-label", "Second task");
    f.update(0);
    f.api.setProgress(f.spinner, {determinate: false});
    assert.equal(f.spinner.getAttribute("aria-label"), "Second task");
});

test("labels are DOM attributes, with an accessible fallback for empty or invalid labels", () => {
    const f = fixture();
    for (const label of ["", "   ", null, 12]) {
        f.update(50, {label});
        assert.equal(f.spinner.getAttribute("aria-label"), "Loading");
    }
    f.update(50, {label: "<img onerror='bad'>"});
    assert.equal(f.spinner.getAttribute("aria-label"), "<img onerror='bad'>");
    assert.equal(f.svg.children.length, 3);
});
