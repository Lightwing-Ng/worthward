"""
Tests for CSS foundation token registry and runtime default drift protection.

Code version: v1.0.0
"""

from __future__ import annotations

import ast
import unittest
from pathlib import Path

from app.web.token_registry import FOUNDATION_TOKENS_CSS_PATH, load_foundation_css_token_registry


REPO_ROOT = Path(__file__).resolve().parents[1]
WEB_RUNTIME_PATH = REPO_ROOT / "app" / "web" / "runtime.py"


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


def collect_frosted_glass_material_defaults() -> dict[str, str]:
    module = ast.parse(read_text(WEB_RUNTIME_PATH))
    target_function = next(
        node
        for node in ast.walk(module)
        if isinstance(node, ast.FunctionDef) and node.name == "build_material_token_rows"
    )

    for node in ast.walk(target_function):
        if not isinstance(node, ast.Dict):
            continue
        items: dict[str, ast.AST] = {}
        for key_node, value_node in zip(node.keys, node.values):
            if isinstance(key_node, ast.Constant) and isinstance(key_node.value, str):
                items[key_node.value] = value_node
        name_node = items.get("name")
        tokens_node = items.get("tokens")
        if not isinstance(name_node, ast.Constant) or name_node.value != "Frosted glass":
            continue
        if not isinstance(tokens_node, ast.Call):
            continue
        if not isinstance(tokens_node.func, ast.Name) or tokens_node.func.id != "standard_material_tokens":
            continue
        values = []
        for argument in tokens_node.args:
            if not isinstance(argument, ast.Constant) or not isinstance(argument.value, str):
                raise AssertionError("Expected literal string defaults in the Frosted glass material row.")
            values.append(argument.value)
        return {
            "--glass-surface-background": values[0],
            "--glass-surface-border": values[1],
            "--glass-surface-shadow": values[2],
            "--glass-surface-blur": values[3],
        }

    raise AssertionError("Could not locate the baseline Frosted glass material token row.")


class WebTokenRegistryTests(unittest.TestCase):
    def test_loader_reads_foundation_root_tokens(self) -> None:
        registry = load_foundation_css_token_registry()

        self.assertGreaterEqual(len(registry), 100)
        self.assertIn("--mode-switch-radius", registry)
        self.assertEqual(registry["--mode-switch-radius"].value, "var(--radius-pill)")
        self.assertEqual(registry["--glass-surface-shadow"].value, "0 18px 40px rgba(17, 24, 39, 0.10)")
        self.assertEqual(registry["--font-size-8"].value, "36px")
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

    def test_frosted_glass_baseline_material_defaults_match_foundation_css(self) -> None:
        registry = load_foundation_css_token_registry()
        runtime_defaults = collect_frosted_glass_material_defaults()

        drift = {
            token_name: {
                "runtime": runtime_value,
                "css": registry[token_name].value,
                "line": registry[token_name].line,
            }
            for token_name, runtime_value in runtime_defaults.items()
            if runtime_value != registry[token_name].value
        }

        self.assertEqual(
            drift,
            {},
            "Baseline material tokens drifted from tokens.css foundation defaults.",
        )


if __name__ == "__main__":
    unittest.main()
