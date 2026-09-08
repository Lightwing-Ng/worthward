/* Code version: v1.0.0 */
(function (globalScope) {
    "use strict";

    // Adapters own rendering, selection, positioning, and outside-click policy.
    // This controller uses DOM focus, not aria-activedescendant on a blurred trigger.
    function createController({getTrigger, getMenu, getOptions, open, close}) {
        const navigationKeys = ["ArrowDown", "ArrowUp", "Home", "End"];
        const options = () => Array.from(getOptions()).filter((option) =>
            !option.disabled && !option.hidden && option.getAttribute("aria-disabled") !== "true");
        const selectedIndex = (items) => Math.max(0,
            items.findIndex((option) => option.getAttribute("aria-selected") === "true"));

        function highlightSelected() {
            const items = options();
            const selected = items[selectedIndex(items)];
            Array.from(getOptions()).forEach((option) =>
                option.classList.toggle("is-active", option === selected));
            getTrigger()?.removeAttribute("aria-activedescendant");
        }

        function focusOption(index = null) {
            const items = options();
            if (!items.length) return;
            const target = items[index === null ? selectedIndex(items)
                : Math.max(0, Math.min(items.length - 1, index))];
            Array.from(getOptions()).forEach((option) =>
                option.classList.toggle("is-active", option === target));
            getTrigger()?.removeAttribute("aria-activedescendant");
            target.focus({preventScroll: true});
            target.scrollIntoView({block: "nearest"});
        }

        function dismiss(restoreFocus) {
            // Focus the trigger before a portaled menu is hidden or reparented.
            if (restoreFocus) getTrigger()?.focus({preventScroll: true});
            close();
            getTrigger()?.removeAttribute("aria-activedescendant");
        }

        function triggerKeydown(event) {
            const menu = getMenu();
            if (!menu || getTrigger()?.disabled) return;
            if (event.key === "Tab" && !menu.hidden) {
                dismiss(false);
                return;
            }
            if (event.key === "Escape" && !menu.hidden) {
                event.preventDefault();
                dismiss(true);
                return;
            }
            if (!navigationKeys.includes(event.key)) return;
            event.preventDefault();
            open();
            focusOption(event.key === "Home" ? 0
                : event.key === "End" ? options().length - 1 : null);
        }

        function menuKeydown(event) {
            if (!getMenu() || getMenu().hidden) return;
            const items = options();
            const active = getMenu().ownerDocument.activeElement;
            const currentIndex = items.indexOf(active);
            if (navigationKeys.includes(event.key)) {
                event.preventDefault();
                const current = currentIndex < 0 ? selectedIndex(items) : currentIndex;
                focusOption(event.key === "Home" ? 0
                    : event.key === "End" ? items.length - 1
                        : current + (event.key === "ArrowDown" ? 1 : -1));
            } else if (event.key === "Escape") {
                event.preventDefault();
                dismiss(true);
            } else if (event.key === "Enter" || event.key === " ") {
                if (currentIndex < 0) return;
                event.preventDefault();
                // Restore focus before a selection callback can navigate or replace the DOM.
                getTrigger()?.focus({preventScroll: true});
                items[currentIndex].click();
            } else if (event.key === "Tab") {
                // Let the browser traverse from the trigger; never trap Tab in a body portal.
                dismiss(true);
            }
        }

        function bindKeyboard() {
            const trigger = getTrigger();
            const menu = getMenu();
            trigger?.addEventListener("keydown", triggerKeydown);
            menu?.addEventListener("keydown", menuKeydown);
            return () => {
                trigger?.removeEventListener("keydown", triggerKeydown);
                menu?.removeEventListener("keydown", menuKeydown);
            };
        }

        return Object.freeze({triggerKeydown, menuKeydown, focusOption, highlightSelected, bindKeyboard});
    }

    globalScope.SHARED_SELECT = Object.freeze({createController});
})(globalThis);
