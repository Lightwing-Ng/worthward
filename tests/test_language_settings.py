"""
Tests for default language mapping coverage in Settings.

Code version: v0.1.0
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from app.core.language_settings import DEFAULT_TRANSLATION_ROWS, LanguageSettings, build_translation_map


REPO_ROOT = Path(__file__).resolve().parents[1]
SETTINGS_TEMPLATE_PATH = REPO_ROOT / "app" / "web" / "templates" / "settings.html"
SETTINGS_CSS_PATH = REPO_ROOT / "app" / "web" / "static" / "assets" / "css" / "views" / "settings.css"
SETTINGS_JS_PATH = REPO_ROOT / "app" / "web" / "static" / "assets" / "js" / "settings.js"


class LanguageSettingsTests(unittest.TestCase):
    def test_default_mapping_covers_every_general_settings_translation_key(self) -> None:
        template = SETTINGS_TEMPLATE_PATH.read_text(encoding="utf-8")
        template_keys = set(re.findall(r"translate_ui\('([^']+)'\)", template))
        translations = build_translation_map(LanguageSettings())

        self.assertEqual(template_keys - set(translations), set())
        self.assertGreaterEqual(len(DEFAULT_TRANSLATION_ROWS), 62)

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

    def test_language_tabs_reuse_the_standard_segmented_control(self) -> None:
        template = SETTINGS_TEMPLATE_PATH.read_text(encoding="utf-8")
        stylesheet = SETTINGS_CSS_PATH.read_text(encoding="utf-8")
        script = SETTINGS_JS_PATH.read_text(encoding="utf-8")

        self.assertIn('class="settings-language-tabs segmented-control"', template)
        self.assertIn('data-option-count="2"', template)
        self.assertIn('class="settings-language-tab segmented-control-option is-active"', template)
        self.assertNotIn(".settings-language-tabs::before", stylesheet)
        self.assertIn('"--segmented-active-index"', script)


if __name__ == "__main__":
    unittest.main()
