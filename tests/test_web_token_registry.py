"""
Tests for CSS foundation token registry and runtime default drift protection.

Code version: v0.6.1
"""

from __future__ import annotations

import ast
from collections import Counter
import re
import unittest
from pathlib import Path

from app.web.token_registry import FOUNDATION_TOKENS_CSS_PATH, load_foundation_css_token_registry


REPO_ROOT = Path(__file__).resolve().parents[1]
WEB_RUNTIME_PATH = REPO_ROOT / "app" / "web" / "runtime.py"
WEB_CSS_ROOT = REPO_ROOT / "app" / "web" / "static" / "assets" / "css"
WEB_FONTS_ROOT = REPO_ROOT / "app" / "web" / "static" / "assets" / "fonts"


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def collect_literal_runtime_defaults(function_name: str) -> dict[str, str]:
    module = ast.parse(read_text(WEB_RUNTIME_PATH))
    target_function = next(
        node
        for node in ast.walk(module)
        if isinstance(node, ast.FunctionDef) and node.name == function_name
    )

    defaults: dict[str, str] = {}
    for node in ast.walk(target_function):
        if not isinstance(node, ast.Call):
            continue
        if not isinstance(node.func, ast.Name):
            continue
        if node.func.id not in {"px_token", "raw_token"}:
            continue
        if len(node.args) < 2:
            continue
        token_name_node = node.args[0]
        token_value_node = node.args[1]
        if not isinstance(token_name_node, ast.Constant) or not isinstance(token_name_node.value, str):
            continue
        if not isinstance(token_value_node, ast.Constant):
            continue
        if node.func.id == "px_token" and isinstance(token_value_node.value, int):
            defaults[token_name_node.value] = f"{token_value_node.value}px"
        elif node.func.id == "raw_token" and isinstance(token_value_node.value, str):
            defaults[token_name_node.value] = token_value_node.value
    return defaults


def collect_literal_runtime_token_names(function_name: str) -> list[str]:
    module = ast.parse(read_text(WEB_RUNTIME_PATH))
    target_function = next(
        node
        for node in ast.walk(module)
        if isinstance(node, ast.FunctionDef) and node.name == function_name
    )

    names: list[str] = []
    for node in ast.walk(target_function):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
            continue
        if node.func.id not in {"px_token", "raw_token", "material_reference_token"}:
            continue
        if not node.args:
            continue
        token_name_node = node.args[0]
        if isinstance(token_name_node, ast.Constant) and isinstance(token_name_node.value, str):
            names.append(token_name_node.value)
    return names


def collect_material_rows() -> dict[str, set[str]]:
    module = ast.parse(read_text(WEB_RUNTIME_PATH))
    target_function = next(
        node
        for node in ast.walk(module)
        if isinstance(node, ast.FunctionDef) and node.name == "build_material_token_rows"
    )

    rows: dict[str, set[str]] = {}
    for node in ast.walk(target_function):
        if not isinstance(node, ast.Dict):
            continue
        items: dict[str, ast.AST] = {}
        for key_node, value_node in zip(node.keys, node.values):
            if isinstance(key_node, ast.Constant) and isinstance(key_node.value, str):
                items[key_node.value] = value_node
        name_node = items.get("name")
        sample_kind_node = items.get("sample_kind")
        tokens_node = items.get("tokens")
        if not isinstance(name_node, ast.Constant) or not isinstance(name_node.value, str):
            continue
        if not isinstance(sample_kind_node, ast.Constant) or sample_kind_node.value != "glass-surface":
            continue
        if not isinstance(tokens_node, ast.List):
            continue
        token_names = {
            element.args[0].value
            for element in tokens_node.elts
            if isinstance(element, ast.Call)
            and isinstance(element.func, ast.Name)
            and element.func.id == "raw_token"
            and element.args
            and isinstance(element.args[0], ast.Constant)
            and isinstance(element.args[0].value, str)
        }
        rows[name_node.value] = token_names
    return rows


class WebTokenRegistryTests(unittest.TestCase):
    def test_univers_next_uses_the_complete_collection_and_face_contract(self) -> None:
        fonts_css = read_text(WEB_CSS_ROOT / "foundation" / "fonts.css")
        tokens_css = read_text(FOUNDATION_TOKENS_CSS_PATH)
        collection_path = WEB_FONTS_ROOT / "UniversNextforHSBC.ttc"

        self.assertTrue(collection_path.is_file())
        self.assertEqual(collection_path.read_bytes()[:4], b"ttcf")
        self.assertIn('font-family: "Univers Next for HSBC";', fonts_css)
        self.assertIn('format("truetype-collection")', fonts_css)
        self.assertNotIn("hsbc-compatible/", fonts_css)
        self.assertIn('--font-family-brand: "Univers Next for HSBC";', tokens_css)
        self.assertIn("font-synthesis: none", tokens_css)

        for postscript_name in (
            "UniversNextforHSBC-UltraLight",
            "UniversNextforHSBC-UltraLightItalic",
            "UniversNextforHSBC-Thin",
            "UniversNextforHSBC-ThinItalic",
            "UniversNextforHSBC-Light",
            "UniversNextforHSBC-LightItalic",
            "UniversNextforHSBC-Regular",
            "UniversNextforHSBC-Medium",
            "UniversNextforHSBC-Bold",
        ):
            self.assertIn(f"#{postscript_name}", fonts_css)

    def test_style_token_registry_names_are_unique(self) -> None:
        token_names = collect_literal_runtime_token_names("build_style_token_rows")
        duplicates = sorted(
            token_name
            for token_name, count in Counter(token_names).items()
            if count > 1
        )

        self.assertGreaterEqual(len(token_names), 100)
        self.assertEqual(duplicates, [])

    def test_loader_reads_foundation_root_tokens(self) -> None:
        registry = load_foundation_css_token_registry()

        self.assertGreaterEqual(len(registry), 100)
        self.assertIn("--mode-switch-radius", registry)
        self.assertEqual(registry["--mode-switch-radius"].value, "var(--radius-pill)")
        self.assertEqual(
            registry["--frosted-glass-shadow"].value,
            "0 18px 40px rgba(10, 14, 25, 0.12), inset 0 1px 0 color-mix(in srgb, var(--theme-glass-highlight) 52%, transparent)",
        )
        self.assertEqual(registry["--font-size-8"].value, "36px")
        self.assertEqual(registry["--tooltip-background"].value, "var(--frosted-glass-background)")
        self.assertEqual(registry["--glass-mask-shadow"].value, "0 12px 24px var(--theme-glass-border)")
        self.assertEqual(registry["--mode-switch-radius"].source_path.resolve(), FOUNDATION_TOKENS_CSS_PATH.resolve())
        self.assertGreater(registry["--mode-switch-radius"].line, 1)

    def test_style_and_font_runtime_defaults_match_foundation_css_baseline(self) -> None:
        registry = load_foundation_css_token_registry()
        runtime_defaults = {}
        runtime_defaults.update(collect_literal_runtime_defaults("build_style_token_rows"))
        runtime_defaults.update(collect_literal_runtime_defaults("build_font_token_rows"))

        comparable_defaults = {
            token_name: value
            for token_name, value in runtime_defaults.items()
            if token_name in registry
        }

        self.assertGreaterEqual(len(comparable_defaults), 50)
        drift = {
            token_name: {
                "runtime": runtime_value,
                "css": registry[token_name].value,
                "line": registry[token_name].line,
            }
            for token_name, runtime_value in comparable_defaults.items()
            if runtime_value != registry[token_name].value
        }

        self.assertEqual(
            drift,
            {},
            "Runtime token defaults drifted from tokens.css foundation baseline.",
        )

    def test_material_registry_only_exposes_canonical_frosted_glass(self) -> None:
        registry = load_foundation_css_token_registry()
        material_rows = collect_material_rows()
        self.assertEqual(
            material_rows,
            {
                "Frosted glass": {
                    "--frosted-glass-background",
                    "--frosted-glass-border",
                    "--frosted-glass-shadow",
                    "--frosted-glass-blur",
                },
            },
        )
        for token_name in material_rows["Frosted glass"]:
            self.assertIn(token_name, registry)

    def test_material_settings_page_renders_one_canonical_card(self) -> None:
        from app import create_app

        response = create_app().test_client().get("/settings/material-tokens")
        html = response.get_data(as_text=True)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(html.count("data-style-token-card="), 1)
        self.assertEqual(html.count('data-style-token-card="frosted-glass"'), 1)
        self.assertEqual(html.count('<p class="style-token-title">Frosted glass</p>'), 1)
        self.assertEqual(html.count('class="report-card style-token-demo-card"'), 1)
        self.assertNotIn("data-inline-backdrop-filter", html)
        self.assertNotIn("data-inline-border", html)
        self.assertNotIn("data-inline-box-shadow", html)

    def test_every_canonical_frosted_glass_reference_is_defined(self) -> None:
        registry = load_foundation_css_token_registry()
        source_text = read_text(WEB_RUNTIME_PATH)
        source_text += "\n".join(read_text(path) for path in WEB_CSS_ROOT.rglob("*.css"))
        references = set(re.findall(r"var\((--frosted-glass-[a-z-]+)\)", source_text))

        self.assertGreaterEqual(len(references), 7)
        self.assertEqual(references - set(registry), set())


if __name__ == "__main__":
    unittest.main()
