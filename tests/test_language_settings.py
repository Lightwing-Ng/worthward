"""Tests for complete Settings language mapping coverage.

Code version: v0.3.0
"""

from __future__ import annotations

import ast
import re
import tomllib
import unittest
from pathlib import Path

from app.core.language_settings import (
    DEFAULT_TRANSLATION_ROWS,
    LANGUAGE_LABELS,
    TRANSLATION_KEY_ALIASES,
    LanguageSettings,
    build_translation_map,
    translate_nested_text,
)
from app.core.settings import get_settings
from app.web.strategy_forms import build_strategy_settings_rows
from app.web.style_token_rows import (
    build_export_image_rows,
    build_font_token_rows,
    build_material_token_rows,
    build_style_token_rows,
)
from strategies.loader import instantiate_strategy, list_enabled_strategies


REPO_ROOT = Path(__file__).resolve().parents[1]
SETTINGS_TEMPLATE_PATH = REPO_ROOT / "app" / "web" / "templates" / "settings.html"
BASE_TEMPLATE_PATH = REPO_ROOT / "app" / "web" / "templates" / "base.html"
RUNTIME_PATH = REPO_ROOT / "app" / "web" / "runtime.py"
APP_JS_PATH = REPO_ROOT / "app" / "web" / "static" / "assets" / "js" / "app.js"
SETTINGS_CSS_PATH = REPO_ROOT / "app" / "web" / "static" / "assets" / "css" / "views" / "settings.css"
SETTINGS_JS_PATH = REPO_ROOT / "app" / "web" / "static" / "assets" / "js" / "settings.js"
CONFIG_PATH = REPO_ROOT / "config.toml"

TRANSLATION_CALL_RE = re.compile(
    r'''(?:translate_ui|translateUi)\(\s*(?P<quoted>"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')'''
)


def extract_literal_translation_keys(path: Path) -> set[str]:
    keys: set[str] = set()
    source = path.read_text(encoding="utf-8")
    for match in TRANSLATION_CALL_RE.finditer(source):
        value = ast.literal_eval(match.group("quoted"))
        if isinstance(value, str):
            keys.add(value)
    return keys


class LanguageSettingsTests(unittest.TestCase):
    def test_default_mapping_covers_every_general_settings_translation_key(self) -> None:
        translations = build_translation_map(LanguageSettings())
        translation_keys = set(translations)

        source_paths = (
            BASE_TEMPLATE_PATH,
            SETTINGS_TEMPLATE_PATH,
            RUNTIME_PATH,
            APP_JS_PATH,
            SETTINGS_JS_PATH,
        )
        source_keys = set().union(*(extract_literal_translation_keys(path) for path in source_paths))
        self.assertEqual(source_keys - translation_keys, set())

        with CONFIG_PATH.open("rb") as config_file:
            config = tomllib.load(config_file)
        label_values = {
            str(value).strip()
            for value in config.get("ui", {}).get("labels", {}).values()
            if str(value).strip()
        }
        self.assertEqual(label_values - translation_keys, set())

        self.assertEqual(len(DEFAULT_TRANSLATION_ROWS), len(translation_keys))
        self.assertGreaterEqual(len(DEFAULT_TRANSLATION_ROWS), 500)
        self.assertEqual(TRANSLATION_KEY_ALIASES["Export image"], "Export images")
        self.assertEqual(LANGUAGE_LABELS["zh_hans_cn"], "简体中文(中国大陆)")
        self.assertEqual(
            TRANSLATION_KEY_ALIASES["简体中文（中国大陆）"],
            "简体中文(中国大陆)",
        )
        self.assertNotIn("Export image", translation_keys)
        self.assertNotIn("简体中文（中国大陆）", translation_keys)

        for row in DEFAULT_TRANSLATION_ROWS:
            self.assertTrue(row["en"])
            self.assertTrue(row["zh_hant_hk"])
            self.assertTrue(row["zh_hans_cn"])

        for key in {
            "Change",
            "Current",
            "History",
            "Language mapping pages",
            "No language mapping changes recorded yet.",
            "Saving translations...",
            "Timestamp",
            "Upload i18n mapping",
        }:
            self.assertTrue(translations[key]["zh_hant_hk"])
            self.assertTrue(translations[key]["zh_hans_cn"])

    def test_dynamic_settings_payloads_are_translated_recursively(self) -> None:
        labels = get_settings()["ui"]["labels"]
        strategy_options = list_enabled_strategies()
        payloads = {
            "style": build_style_token_rows(labels),
            "font": build_font_token_rows(labels),
            "material": build_material_token_rows(),
            "export": build_export_image_rows("https://example.com"),
            "strategy": build_strategy_settings_rows(
                strategy_options,
                strategy_factory=instantiate_strategy,
            ),
        }
        translations = build_translation_map(
            LanguageSettings(language="zh_hans_cn")
        )

        localized = {
            name: translate_nested_text(payload, "zh_hans_cn", translations)
            for name, payload in payloads.items()
        }

        style_row = next(
            row for row in localized["style"] if row["name"] == "文本输入控件"
        )
        self.assertEqual(style_row["name"], "文本输入控件")
        font_row = next(row for row in localized["font"] if row["name"] == "原始尺度")
        self.assertEqual(font_row["description"], "设计系统定义的基础像素大小；语义文字角色会继承这些源令牌。")
        self.assertEqual(localized["material"][0]["name"], "磨砂玻璃")
        self.assertEqual(localized["export"][0]["name"], "投资社区分享卡片")
        self.assertIn("机器学习", {row["category"] for row in localized["strategy"]})

    def test_language_tabs_reuse_the_standard_segmented_control(self) -> None:
        template = SETTINGS_TEMPLATE_PATH.read_text(encoding="utf-8")
        stylesheet = SETTINGS_CSS_PATH.read_text(encoding="utf-8")
        script = SETTINGS_JS_PATH.read_text(encoding="utf-8")

        self.assertIn('class="settings-language-tabs segmented-control segmented-control--tabs"', template)
        self.assertIn('data-option-count="2"', template)
        self.assertIn('data-active="{{ settings_tab }}"', template)
        self.assertIn('class="settings-language-tab segmented-control-option"', template)
        self.assertIn('data-language-initial-page=', template)
        self.assertNotIn(".settings-language-tabs::before", stylesheet)
        self.assertNotIn(".settings-language-tab.is-active", stylesheet)
        self.assertIn('"--segmented-active-index"', script)


if __name__ == "__main__":
    unittest.main()
