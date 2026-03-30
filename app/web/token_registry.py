"""
Helpers for loading CSS token definitions from the web foundation layer.

Code version: v0.3.0
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
import re

FOUNDATION_TOKENS_CSS_PATH = (
        Path(__file__).resolve().parent
        / "static"
        / "assets"
        / "css"
        / "foundation"
        / "tokens.css"
)


@dataclass(frozen=True)
class CssTokenDefinition:
    """A CSS custom property declared inside the foundation :root block."""

    name: str
    value: str
    line: int
    source_path: Path


def _extract_root_block(css_text: str) -> tuple[int, str]:
    selector_index = css_text.find(":root")
    if selector_index == -1:
        raise ValueError("Could not find a :root selector in the foundation token stylesheet.")

    block_start = css_text.find("{", selector_index)
    if block_start == -1:
        raise ValueError("Could not find the opening brace for the :root token block.")

    depth = 0
    for index in range(block_start, len(css_text)):
        character = css_text[index]
        if character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                return block_start + 1, css_text[block_start + 1:index]

    raise ValueError("Could not find the closing brace for the :root token block.")


def _parse_root_css_tokens(css_path: Path) -> dict[str, CssTokenDefinition]:
    css_text = css_path.read_text(encoding="utf-8")
    root_content_start, root_content = _extract_root_block(css_text)

    registry: dict[str, CssTokenDefinition] = {}
    declaration_pattern = re.compile(r"(?P<name>--[A-Za-z0-9_-]+)\s*:\s*(?P<value>.*?);", re.DOTALL)

    for match in declaration_pattern.finditer(root_content):
        token_name = match.group("name")
        token_value = match.group("value").strip()
        absolute_start = root_content_start + match.start()
        line_number = css_text.count("\n", 0, absolute_start) + 1
        registry[token_name] = CssTokenDefinition(
            name=token_name,
            value=token_value,
            line=line_number,
            source_path=css_path,
        )

    return registry


@lru_cache(maxsize=4)
def _load_cached_css_token_registry(css_path_text: str) -> dict[str, CssTokenDefinition]:
    return _parse_root_css_tokens(Path(css_path_text))


def load_foundation_css_token_registry(
        css_path: Path | None = None,
) -> dict[str, CssTokenDefinition]:
    """Load only the foundation :root token declarations used as baseline defaults."""

    target_path = (css_path or FOUNDATION_TOKENS_CSS_PATH).resolve()
    return dict(_load_cached_css_token_registry(str(target_path)))
