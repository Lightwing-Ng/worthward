"""
Language preference persistence and translation helpers.

Code version: v0.2.0
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from app.core.config import SETTINGS_STORE_DIR
from app.core.settings_store import LEGACY_SECTION_PATHS, load_settings_section, save_settings_section

LanguageCode = Literal["en", "zh_hant_hk", "zh_hans_cn"]

LANGUAGE_SETTINGS_PATH = SETTINGS_STORE_DIR / "language.json"
LEGACY_SECTION_PATHS["language"] = LANGUAGE_SETTINGS_PATH

DEFAULT_LANGUAGE_CODE: LanguageCode = "en"
SUPPORTED_LANGUAGE_CODES: tuple[LanguageCode, ...] = ("en", "zh_hant_hk", "zh_hans_cn")
LANGUAGE_LABELS: dict[LanguageCode, str] = {
    "en": "English",
    "zh_hant_hk": "繁體中文（香港）",
    "zh_hans_cn": "简体中文（中国大陆）",
}
HTML_LANG_BY_LANGUAGE: dict[LanguageCode, str] = {
    "en": "en-US",
    "zh_hant_hk": "zh-HK",
    "zh_hans_cn": "zh-CN",
}

DEFAULT_TRANSLATION_ROWS: tuple[dict[str, str], ...] = (
    {"en": "About", "zh_hant_hk": "關於", "zh_hans_cn": "关于"},
    {"en": "Appearance", "zh_hant_hk": "外觀", "zh_hans_cn": "外观"},
    {"en": "Backtest", "zh_hant_hk": "回測", "zh_hans_cn": "回测"},
    {"en": "Broker access", "zh_hant_hk": "券商存取", "zh_hans_cn": "券商访问"},
    {"en": "Cash equivalents", "zh_hant_hk": "現金等價物", "zh_hans_cn": "现金等价物"},
    {"en": "Choose the date styles used across long-form and compact displays throughout the workspace.", "zh_hant_hk": "選擇工作區長格式與緊湊顯示使用的日期樣式。", "zh_hans_cn": "选择工作区长格式与紧凑显示使用的日期样式。"},
    {"en": "Choose whether the interface follows your system appearance or stays locked to Light or Dark mode.", "zh_hant_hk": "選擇介面跟隨系統外觀，或固定為淺色或深色模式。", "zh_hans_cn": "选择界面跟随系统外观，或固定为浅色或深色模式。"},
    {"en": "Clear caches", "zh_hant_hk": "清除快取", "zh_hans_cn": "清除缓存"},
    {"en": "Compact", "zh_hant_hk": "短格式", "zh_hans_cn": "短格式"},
    {"en": "Compute your portfolio", "zh_hant_hk": "計算你的投資組合", "zh_hans_cn": "计算你的投资组合"},
    {"en": "Date format", "zh_hant_hk": "日期格式", "zh_hans_cn": "日期格式"},
    {"en": "Dark", "zh_hant_hk": "深色", "zh_hans_cn": "深色"},
    {"en": "Dollar-cost averaging", "zh_hant_hk": "定期定額", "zh_hans_cn": "定投"},
    {"en": "Email (SMTP)", "zh_hant_hk": "電郵（SMTP）", "zh_hans_cn": "电子邮件（SMTP）"},
    {"en": "English", "zh_hant_hk": "English", "zh_hans_cn": "English"},
    {"en": "Export image", "zh_hant_hk": "匯出圖片", "zh_hans_cn": "导出图片"},
    {"en": "Follow your operating system appearance automatically, including live switching when the system changes.", "zh_hant_hk": "自動跟隨作業系統外觀，並在系統變更時即時切換。", "zh_hans_cn": "自动跟随操作系统外观，并在系统变更时实时切换。"},
    {"en": "Font tokens", "zh_hant_hk": "字型權杖", "zh_hans_cn": "字体令牌"},
    {"en": "Force the interface to stay in the bright palette, regardless of the system setting.", "zh_hant_hk": "無論系統設定如何，都讓介面保持明亮配色。", "zh_hans_cn": "无论系统设置如何，都让界面保持明亮配色。"},
    {"en": "Force the interface to stay in the dark palette for lower glare and better nighttime use.", "zh_hant_hk": "讓介面保持深色配色，以降低眩光並改善夜間使用。", "zh_hans_cn": "让界面保持深色配色，以降低眩光并改善夜间使用。"},
    {"en": "Full", "zh_hant_hk": "完整", "zh_hans_cn": "完整"},
    {"en": "General", "zh_hant_hk": "一般", "zh_hans_cn": "通用"},
    {"en": "Language", "zh_hant_hk": "語言", "zh_hans_cn": "语言"},
    {"en": "Light", "zh_hant_hk": "淺色", "zh_hans_cn": "浅色"},
    {"en": "Local market store", "zh_hant_hk": "本機市場資料庫", "zh_hans_cn": "本地市场数据库"},
    {"en": "Material tokens", "zh_hant_hk": "材質權杖", "zh_hans_cn": "材质令牌"},
    {"en": "Trade", "zh_hant_hk": "交易", "zh_hans_cn": "交易"},
    {"en": "Network self-check", "zh_hant_hk": "網絡自檢", "zh_hans_cn": "网络自检"},
    {"en": "Save translations", "zh_hant_hk": "儲存翻譯", "zh_hans_cn": "保存翻译"},
    {"en": "Settings", "zh_hant_hk": "設定", "zh_hans_cn": "设置"},
    {"en": "Strategies", "zh_hant_hk": "策略", "zh_hans_cn": "策略"},
    {"en": "Style tokens", "zh_hant_hk": "樣式權杖", "zh_hans_cn": "样式令牌"},
    {"en": "Switch theme", "zh_hant_hk": "切換主題", "zh_hans_cn": "切换主题"},
    {"en": "Switch to Dark mode", "zh_hant_hk": "切換至深色模式", "zh_hans_cn": "切换至深色模式"},
    {"en": "Switch to Light mode", "zh_hant_hk": "切換至淺色模式", "zh_hans_cn": "切换至浅色模式"},
    {"en": "System", "zh_hant_hk": "系統", "zh_hans_cn": "系统"},
    {"en": "繁體中文（香港）", "zh_hant_hk": "繁體中文（香港）", "zh_hans_cn": "繁體中文（香港）"},
    {"en": "简体中文（中国大陆）", "zh_hant_hk": "简体中文（中国大陆）", "zh_hans_cn": "简体中文（中国大陆）"},
)


@dataclass(frozen=True)
class LanguageSettings:
    language: LanguageCode = DEFAULT_LANGUAGE_CODE
    translations: tuple[dict[str, str], ...] = DEFAULT_TRANSLATION_ROWS
    history: tuple[dict[str, object], ...] = ()


def normalize_language_code(value: str | None) -> LanguageCode:
    normalized = str(value or "").strip().lower().replace("-", "_")
    if normalized in {"zh_hant", "zh_hk", "zh_hant_hk"}:
        return "zh_hant_hk"
    if normalized in {"zh_hans", "zh_cn", "zh_hans_cn"}:
        return "zh_hans_cn"
    if normalized in {"en", "en_us", "english"}:
        return "en"
    return DEFAULT_LANGUAGE_CODE


def _normalize_translation_rows(value: Any) -> tuple[dict[str, str], ...]:
    rows = value if isinstance(value, list) else []
    normalized_rows: list[dict[str, str]] = []
    seen_english: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        english = str(row.get("en", "")).strip()
        if not english or english in seen_english:
            continue
        normalized_rows.append(
            {
                "en": english,
                "zh_hant_hk": str(row.get("zh_hant_hk", "")).strip(),
                "zh_hans_cn": str(row.get("zh_hans_cn", "")).strip(),
            }
        )
        seen_english.add(english)
    for row in DEFAULT_TRANSLATION_ROWS:
        english = row["en"]
        if english not in seen_english:
            normalized_rows.append(dict(row))
            seen_english.add(english)
    return tuple(sorted(normalized_rows, key=lambda row: row["en"].casefold()))


def _normalize_history_entries(value: Any) -> tuple[dict[str, object], ...]:
    rows = value if isinstance(value, list) else []
    normalized_rows: list[dict[str, object]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        timestamp = str(row.get("timestamp", "")).strip()
        changes = row.get("changes", [])
        if not timestamp or not isinstance(changes, list):
            continue
        clean_changes = [str(change).strip() for change in changes if str(change).strip()]
        if clean_changes:
            normalized_rows.append(
                {
                    "timestamp": timestamp,
                    "source": str(row.get("source", "")).strip(),
                    "changes": clean_changes,
                }
            )
    return tuple(normalized_rows[-200:])


def _current_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def diff_translation_rows(
    previous_rows: tuple[dict[str, str], ...],
    next_rows: tuple[dict[str, str], ...],
) -> list[str]:
    previous = {row["en"]: row for row in previous_rows}
    next_map = {row["en"]: row for row in next_rows}
    changes: list[str] = []
    for english in sorted(set(previous) | set(next_map), key=str.casefold):
        old_row = previous.get(english)
        next_row = next_map.get(english)
        if old_row is None and next_row is not None:
            changes.append(f"Added {english}")
            continue
        if old_row is not None and next_row is None:
            changes.append(f"Removed {english}")
            continue
        if old_row is None or next_row is None:
            continue
        field_changes = []
        for field_name, field_label in (("zh_hant_hk", "繁體中文（香港）"), ("zh_hans_cn", "简体中文（中国大陆）")):
            old_value = old_row.get(field_name, "")
            next_value = next_row.get(field_name, "")
            if old_value != next_value:
                field_changes.append(f"{field_label}: {old_value or 'blank'} -> {next_value or 'blank'}")
        if field_changes:
            changes.append(f"{english}: {'; '.join(field_changes)}")
    return changes


def load_language_settings() -> LanguageSettings:
    try:
        payload = load_settings_section("language")
    except OSError:
        return LanguageSettings()
    return LanguageSettings(
        language=normalize_language_code(payload.get("language")),
        translations=_normalize_translation_rows(payload.get("translations")),
        history=_normalize_history_entries(payload.get("history")),
    )


def save_language_settings(
    *,
    language: str | None = None,
    translations: list[dict[str, str]] | None = None,
    history_label: str = "Manual edit",
) -> LanguageSettings:
    current = load_language_settings()
    next_translations = _normalize_translation_rows(translations if translations is not None else list(current.translations))
    changes = diff_translation_rows(current.translations, next_translations) if translations is not None else []
    next_history = list(current.history)
    if changes:
        next_history.append(
            {
                "timestamp": _current_timestamp(),
                "source": history_label,
                "changes": changes,
            }
        )
    next_settings = LanguageSettings(
        language=normalize_language_code(language or current.language),
        translations=next_translations,
        history=_normalize_history_entries(next_history),
    )
    SETTINGS_STORE_DIR.mkdir(parents=True, exist_ok=True)
    save_settings_section(
        "language",
        {
            "language": next_settings.language,
            "translations": list(next_settings.translations),
            "history": list(next_settings.history),
        },
    )
    return next_settings


def save_language_code(value: str) -> LanguageCode:
    return save_language_settings(language=value).language


def build_translation_map(settings: LanguageSettings | None = None) -> dict[str, dict[str, str]]:
    current = settings or load_language_settings()
    return {row["en"]: dict(row) for row in current.translations}


def translate_text(value: str, language: LanguageCode, translations: dict[str, dict[str, str]]) -> str:
    if language == "en":
        return value
    row = translations.get(value)
    if not row:
        return value
    return row.get(language) or value


def translate_labels(labels: dict[str, str], settings: LanguageSettings) -> dict[str, str]:
    translations = build_translation_map(settings)
    return {
        key: translate_text(str(value), settings.language, translations)
        for key, value in labels.items()
    }
