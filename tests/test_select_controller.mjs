/* Code version: v1.0.1 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../app/web/static/assets/js/select-controller.js", import.meta.url), "utf8");
function fixture() {
    const context = {};
    vm.runInNewContext(source, context);
    const doc = {activeElement: null};
    function element(selected = false) {
        const attrs = new Map([["aria-selected", String(selected)]]);
        const listeners = new Map();
        return {disabled: false, hidden: false, clicked: 0, ownerDocument: doc,
            classList: {toggle() {}},
            getAttribute: key => attrs.get(key),
            removeAttribute: key => attrs.delete(key),
            focus() {doc.activeElement = this;},
            scrollIntoView() {},
            click() {this.clicked++;},
            addEventListener(key, handler) {listeners.set(key, handler);},
            removeEventListener(key, handler) {if (listeners.get(key) === handler) listeners.delete(key);},
            listeners};
    }
    const trigger = element();
    const menu = element();
    menu.hidden = true;
    let items = [element(), element(true), element()];
    const controller = context.SHARED_SELECT.createController({
        getTrigger: () => trigger, getMenu: () => menu, getOptions: () => items,
        open() {menu.hidden = false;}, close() {menu.hidden = true;},
    });
    function key(method, key) {
        const event = {key, prevented: false, propagationStopped: false,
            preventDefault() {this.prevented = true;},
            stopPropagation() {this.propagationStopped = true;}};
        controller[method](event);
        return event;
    }
    return {doc, trigger, menu, controller, key, get items() {return items;}, replace(value) {items = value;}};
}
test("opening focuses selected without committing; navigation clamps and skips disabled", () => {
    const f = fixture();
    f.key("triggerKeydown", "ArrowDown");
    assert.equal(f.doc.activeElement, f.items[1]);
    assert.equal(f.items[1].clicked, 0);
    f.items[2].disabled = true;
    f.key("menuKeydown", "ArrowDown");
    assert.equal(f.doc.activeElement, f.items[1]);
    f.key("menuKeydown", "Home");
    assert.equal(f.doc.activeElement, f.items[0]);
    f.key("menuKeydown", "ArrowUp");
    assert.equal(f.doc.activeElement, f.items[0]);
});
test("Home/End open at boundaries; Escape restores trigger without selection", () => {
    const f = fixture();
    f.key("triggerKeydown", "End");
    assert.equal(f.doc.activeElement, f.items[2]);
    const escape = f.key("menuKeydown", "Escape");
    assert.equal(f.doc.activeElement, f.trigger);
    assert.equal(f.menu.hidden, true);
    assert.equal(f.items[2].clicked, 0);
    assert.equal(escape.propagationStopped, true);
    f.key("triggerKeydown", "Home");
    assert.equal(f.doc.activeElement, f.items[0]);
});
for (const key of ["Enter", " "]) {
    test(key + " commits exactly once with focus restored first", () => {
        const f = fixture();
        f.key("triggerKeydown", "ArrowUp");
        f.items[1].click = () => {
            assert.equal(f.doc.activeElement, f.trigger);
            f.items[1].clicked++;
        };
        assert.equal(f.key("menuKeydown", key).prevented, true);
        assert.equal(f.items[1].clicked, 1);
    });
}
test("Tab closes without preventing native traversal from trigger", () => {
    const f = fixture();
    f.key("triggerKeydown", "ArrowDown");
    assert.equal(f.key("menuKeydown", "Tab").prevented, false);
    assert.equal(f.doc.activeElement, f.trigger);
    assert.equal(f.menu.hidden, true);
});
test("dynamic and empty options are safe; disabled options cannot commit", () => {
    const f = fixture();
    f.key("triggerKeydown", "End");
    f.items[2].disabled = true;
    f.key("menuKeydown", "Enter");
    assert.equal(f.items[2].clicked, 0);
    f.replace([]);
    f.key("menuKeydown", "End");
    f.key("menuKeydown", " ");
    f.key("menuKeydown", "Escape");
    assert.equal(f.menu.hidden, true);
});
test("binding returns teardown and unrelated keys remain untouched", () => {
    const f = fixture();
    const destroy = f.controller.bindKeyboard();
    assert.equal(f.trigger.listeners.size, 1);
    assert.equal(f.menu.listeners.size, 1);
    assert.equal(f.key("triggerKeydown", "a").prevented, false);
    destroy();
    destroy();
    assert.equal(f.trigger.listeners.size, 0);
    assert.equal(f.menu.listeners.size, 0);
});
test("Tab after pointer opening closes without stealing focus; disabled trigger does not open", () => {
    const f = fixture();
    f.menu.hidden = false;
    f.trigger.focus();
    assert.equal(f.key("triggerKeydown", "Tab").prevented, false);
    assert.equal(f.menu.hidden, true);
    assert.equal(f.doc.activeElement, f.trigger);
    f.trigger.disabled = true;
    assert.equal(f.key("triggerKeydown", "ArrowDown").prevented, false);
    assert.equal(f.menu.hidden, true);
});
