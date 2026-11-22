"""Inspect the rendered markup of Local Market Store pagination.

Code version: v1.0.0
"""

from html.parser import HTMLParser


class LocalStorePaginationStructureParser(HTMLParser):
    _VOID_ELEMENTS = frozenset({"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"})

    def __init__(self) -> None:
        super().__init__()
        self._stack: list[tuple[str, dict[str, str | None]]] = []
        self._active_pagination_index: int | None = None
        self._active_control: tuple[str, int, int] | None = None
        self.pagination_parent_ids: list[str | None] = []
        self.pagination_parent_classes: list[str] = []
        self.pagination_classes: list[str] = []
        self.pagination_attributes: list[dict[str, str | None]] = []
        self.pagination_controls: list[list[dict[str, str | None]]] = []
        self.pagination_ranges: list[list[dict[str, str | None]]] = []
        self.pagination_ellipsis_positions: list[list[str | None]] = []
        self.pagination_indicator_counts: list[int] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "nav" and "data-local-store-pagination" in attributes:
            parent_attributes = self._stack[-1][1] if self._stack else {}
            self.pagination_parent_ids.append(parent_attributes.get("id"))
            self.pagination_parent_classes.append(parent_attributes.get("class") or "")
            self.pagination_classes.append(attributes.get("class") or "")
            self.pagination_attributes.append(attributes)
            self.pagination_controls.append([])
            self.pagination_ranges.append([])
            self.pagination_ellipsis_positions.append([])
            self.pagination_indicator_counts.append(0)
            self._active_pagination_index = len(self.pagination_attributes) - 1
        elif self._active_pagination_index is not None:
            class_names = set((attributes.get("class") or "").split())
            if tag == "a" and "local-store-pagination-range-option" in class_names:
                self.pagination_ranges[self._active_pagination_index].append(attributes)
            if tag in {"a", "button"} and "local-store-page-button" in class_names:
                controls = self.pagination_controls[self._active_pagination_index]
                controls.append({
                    "tag": tag,
                    "class": attributes.get("class"),
                    "href": attributes.get("href"),
                    "target": attributes.get("data-pagination-target"),
                    "current": attributes.get("data-pagination-current"),
                    "aria_label": attributes.get("aria-label"),
                    "aria_current": attributes.get("aria-current"),
                    "text": "",
                })
                self._active_control = (
                    tag,
                    self._active_pagination_index,
                    len(controls) - 1,
                )
            if "local-store-pagination-indicator" in class_names:
                self.pagination_indicator_counts[self._active_pagination_index] += 1
            if "data-pagination-ellipsis" in attributes:
                self.pagination_ellipsis_positions[self._active_pagination_index].append(
                    attributes.get("data-pagination-ellipsis")
                )
        if tag not in self._VOID_ELEMENTS:
            self._stack.append((tag, attributes))

    def handle_data(self, data: str) -> None:
        if self._active_control is None:
            return
        _, pagination_index, control_index = self._active_control
        control = self.pagination_controls[pagination_index][control_index]
        control["text"] = f"{control['text'] or ''}{data}".strip()

    def handle_endtag(self, tag: str) -> None:
        if self._active_control is not None and self._active_control[0] == tag:
            self._active_control = None
        if tag == "nav" and self._active_pagination_index is not None:
            self._active_pagination_index = None
        for index in range(len(self._stack) - 1, -1, -1):
            if self._stack[index][0] == tag:
                del self._stack[index:]
                break
