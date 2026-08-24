"""
Tests for CSS foundation token registry and runtime default drift protection.

Code version: v0.8.2
"""

from __future__ import annotations

import ast
from collections import Counter
import re
import unittest
from pathlib import Path

from app.web.token_registry import FOUNDATION_TOKENS_CSS_PATH, load_foundation_css_token_registry
from app.web.style_token_rows import (
    SHARED_STYLE_TOKEN_NAMES,
    build_color_token_rows,
    build_export_image_rows,
    build_font_token_rows,
    build_material_token_rows,
    build_style_token_rows,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
WEB_RUNTIME_PATH = REPO_ROOT / "app" / "web" / "runtime.py"
STYLE_TOKEN_ROWS_PATH = REPO_ROOT / "app" / "web" / "style_token_rows.py"
WEB_CSS_ROOT = REPO_ROOT / "app" / "web" / "static" / "assets" / "css"
WEB_FONTS_ROOT = REPO_ROOT / "app" / "web" / "static" / "assets" / "fonts"


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def collect_literal_runtime_defaults(function_name: str) -> dict[str, str]:
    module = ast.parse(read_text(STYLE_TOKEN_ROWS_PATH))
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
    module = ast.parse(read_text(STYLE_TOKEN_ROWS_PATH))
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
    module = ast.parse(read_text(STYLE_TOKEN_ROWS_PATH))
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
    def test_numeric_input_controls_share_the_28px_keyboard_contract(self) -> None:
        registry = load_foundation_css_token_registry()
        forms_css = read_text(WEB_CSS_ROOT / "components" / "forms.css")
        compare_template = read_text(REPO_ROOT / "app" / "web" / "templates" / "_compare_portfolio_sidebar.html")
        app_js = read_text(REPO_ROOT / "app" / "web" / "static" / "assets" / "js" / "app.js")

        self.assertEqual(registry["--numeric-input-control-height"].value, "28px")
        self.assertIn('input[type="number"]', forms_css)
        self.assertIn("height: var(--numeric-input-control-height);", forms_css)
        self.assertIn('type="number" inputmode="numeric"', compare_template)
        self.assertIn('type="number" inputmode="numeric"', app_js)

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

    def test_shared_style_inventory_is_kept_out_of_the_settings_specimens(self) -> None:
        labels = {
            "local_store_maintain_button": "Maintain local data",
            "local_store_maintain_title": "Local data maintenance",
            "local_store_maintain_note": "Keep local price data current.",
            "portfolio_total_return": "Portfolio return",
            "hero_title": "Control center",
            "portfolio_title": "Portfolio workspace",
            "backtest_ticker": "Ticker",
            "period": "Period",
            "backtest_strategy": "Strategy",
        }
        style_rows = build_style_token_rows(labels)
        row_names = [str(row["name"]) for row in style_rows]
        self.assertEqual(row_names, sorted(row_names, key=str.casefold))

        self.assertNotIn("Shared style primitives", row_names)

        source_text = "\n".join(
            read_text(path)
            for path in (REPO_ROOT / "app").rglob("*")
            if path.is_file() and path.suffix in {".css", ".html", ".js", ".mjs"}
        )
        source_counts = Counter(re.findall(r"--[a-z][a-z0-9_-]*", source_text))
        for token_name in SHARED_STYLE_TOKEN_NAMES:
            self.assertGreaterEqual(source_counts[token_name], 3)

    def test_design_token_builders_use_only_explicit_presentation_inputs(self) -> None:
        labels = {
            "local_store_maintain_button": "Maintain local data",
            "local_store_maintain_title": "Local data maintenance",
            "local_store_maintain_note": "Keep local price data current.",
            "portfolio_total_return": "Portfolio return",
            "hero_title": "Control center",
            "portfolio_title": "Portfolio workspace",
            "backtest_ticker": "Ticker",
            "period": "Period",
            "backtest_strategy": "Strategy",
        }

        style_rows = build_style_token_rows(labels)
        export_rows = build_export_image_rows("example.test/design-preview")
        font_rows = build_font_token_rows(labels)
        material_rows = build_material_token_rows()
        color_rows = build_color_token_rows(
            {"accent_positive": "#16a34a", "success": "#16a34a", "success_strong": "#16a34a"},
            {"accent_positive": "#2fff9c", "success": "#2fff9c", "success_strong": "#2fff9c"},
        )

        action_package = next(row for row in style_rows if row["name"] == "Settings action package")
        primary_button = next(row for row in style_rows if row["name"] == "Primary button")
        inverted_button = next(row for row in style_rows if row["name"] == "Primary (inverted) button")
        self.assertNotIn("Settings action button", {row["name"] for row in style_rows})
        self.assertEqual(primary_button["id"], "primary-button")
        self.assertEqual(
            primary_button["sample_button_class"],
            "settings-inline-button settings-inline-button-primary",
        )
        self.assertEqual(
            {token["name"] for token in primary_button["tokens"]},
            {
                "--primary-button-background",
                "--primary-button-background-disabled",
                "--primary-button-background-hover",
                "--primary-button-background-pending",
                "--primary-button-border",
                "--primary-button-border-hover",
                "--primary-button-color",
                "--primary-button-color-disabled",
                "--primary-button-min-height",
                "--primary-button-pad-block",
                "--primary-button-pad-inline",
                "--primary-button-radius",
            },
        )
        self.assertEqual(inverted_button["id"], "primary-inverted-button")
        self.assertIn("settings-inline-button-primary-inverted", inverted_button["sample_button_class"])
        self.assertEqual(inverted_button["related_styles"], [])
        self.assertEqual(
            action_package["related_styles"],
            [{"name": "Settings execution option", "target_id": "settings-execution-option"}],
        )
        self.assertEqual(action_package["sample_title"], labels["local_store_maintain_title"])
        self.assertEqual(export_rows[0]["sample_url"], "example.test/design-preview")
        self.assertEqual(font_rows[0]["samples"][5]["sample_text"], labels["hero_title"])
        self.assertEqual(material_rows[0]["name"], "Frosted glass")
        positive_green = next(row for row in color_rows if row["id"] == "positive-green")
        self.assertEqual(
            {token["name"] for token in positive_green["tokens"]},
            {"--theme-accent-positive", "--theme-success", "--theme-success-strong"},
        )
        self.assertEqual(
            next(token for token in positive_green["tokens"] if token["name"] == "--theme-accent-positive")["dark_value"],
            "#2fff9c",
        )

    def test_numeric_fraction_scale_has_one_font_owner_and_shared_markup_inputs(self) -> None:
        labels = {
            "local_store_maintain_button": "Maintain local data",
            "local_store_maintain_title": "Local data maintenance",
            "local_store_maintain_note": "Keep local price data current.",
            "portfolio_total_return": "Portfolio return",
            "hero_title": "Control center",
            "portfolio_title": "Portfolio workspace",
            "backtest_ticker": "Ticker",
            "period": "Period",
            "backtest_strategy": "Strategy",
        }
        style_rows = build_style_token_rows(labels)
        font_rows = build_font_token_rows(labels)
        style_token_names = {
            token["name"]
            for row in style_rows
            for token in row.get("tokens", [])
        }
        font_token_names = {
            token["name"]
            for row in font_rows
            for token in row.get("tokens", [])
        }
        workspace_metric = next(row for row in style_rows if row["name"] == "Workspace metric value")
        workspace_metric_tokens = {token["name"]: token["value"] for token in workspace_metric["tokens"]}
        font_metric_samples = [
            sample
            for row in font_rows
            for sample in row["samples"]
            if sample.get("sample_kind") == "numeric-fraction"
        ]

        self.assertNotIn("--font-numeric-fraction-scale", style_token_names)
        self.assertIn("--font-numeric-fraction-scale", font_token_names)
        self.assertEqual(
            workspace_metric_tokens["--workspace-metric-decimal-scale"],
            "var(--font-numeric-fraction-scale)",
        )
        self.assertGreaterEqual(len(font_metric_samples), 6)

    def test_export_image_defaults_share_the_settings_and_capture_contract(self) -> None:
        export_row = build_export_image_rows("example.test/design-preview")[0]
        export_tokens = {token["name"]: token["value"] for token in export_row["tokens"]}
        investment_css = read_text(WEB_CSS_ROOT / "views" / "investment.css")
        base_template = read_text(REPO_ROOT / "app" / "web" / "templates" / "base.html")
        settings_template = read_text(REPO_ROOT / "app" / "web" / "templates" / "settings.html")

        self.assertEqual(export_tokens["--investment-community-share-shell-width"], "1080px")
        self.assertEqual(export_tokens["--investment-community-share-shell-height"], "1730px")
        self.assertEqual(export_tokens["--investment-community-share-section-gap"], "10px")
        self.assertIn("--investment-community-share-shell-width: 1080px;", investment_css)
        self.assertIn("--investment-community-share-shell-height: 1730px;", investment_css)
        self.assertIn("aspect-ratio: 53.98 / 86.50;", investment_css)
        self.assertIn("export-image-config.js", base_template)
        self.assertIn('data-export-image-profile="investment-community-share"', settings_template)

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
        self.assertEqual(
            registry["--tooltip-background"].value,
            "var(--frosted-glass-surface)",
        )
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
        source_text = read_text(WEB_RUNTIME_PATH) + read_text(STYLE_TOKEN_ROWS_PATH)
        source_text += "\n".join(read_text(path) for path in WEB_CSS_ROOT.rglob("*.css"))
        references = set(re.findall(r"var\((--frosted-glass-[a-z-]+)\)", source_text))

        self.assertGreaterEqual(len(references), 7)
        self.assertEqual(references - set(registry), set())


if __name__ == "__main__":
    unittest.main()
