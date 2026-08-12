"""Pure Settings design-token presentation builders.

Code version: v1.6.3
"""

from __future__ import annotations

from collections.abc import Mapping
import re


def build_style_token_rows(labels: Mapping[str, str]) -> list[dict[str, object]]:
    def style_token_id(name: str) -> str:
        return name.strip().lower().replace(" ", "-")

    def material_token_id(name: str) -> str:
        return name.strip().lower().replace(" ", "-")

    def px_token(name: str, value: int, min_value: int = 0) -> dict[str, object]:
        return {
            "name": name,
            "value": f"{value}px",
            "editable": True,
            "numeric_value": value,
            "unit": "px",
            "min_value": min_value,
        }

    def raw_token(name: str, value: str) -> dict[str, object]:
        text_value = str(value)
        if re.fullmatch(r"-?\d+", text_value):
            numeric_value = int(text_value)
            return {
                "name": name,
                "value": text_value,
                "editable": True,
                "numeric_value": numeric_value,
                "unit": "",
                "min_value": 0 if numeric_value >= 0 else numeric_value,
            }
        return {
            "name": name,
            "value": text_value,
            "editable": False,
        }

    def material_reference_token(name: str, material_name: str) -> dict[str, object]:
        return {
            "name": name,
            "value": material_name,
            "editable": False,
            "reference_label": material_name,
            "reference_target_id": material_token_id(material_name),
        }

    rows = [
        {
            "id": style_token_id("Segmented control"),
            "name": "Segmented control",
            "sample_kind": "range-mode",
            "sample_title": "",
            "sample_copy": "",
            "sample_button": "",
            "sample_button_class": "",
            "sample_icon_class": "",
            "sample_icon_shell_class": "",
            "tokens": [
                raw_token("--mode-switch-radius", "var(--radius-pill)"),
                px_token("--mode-switch-pad", 4, 0),
                px_token("--mode-switch-gap", 4, 0),
                px_token("--mode-switch-min-height", 36, 1),
                px_token("--mode-switch-thumb-inset", 4, 0),
                px_token("--mode-switch-thumb-offset", 6, 0),
                px_token("--mode-switch-label-pad-inline", 12, 0),
                px_token("--mode-switch-label-min-height", 28, 1),
                raw_token("--mode-switch-thumb-background", "var(--accent-fill)"),
            ],
            "related_styles": [],
        },
        {
            "id": style_token_id("Settings action button"),
            "name": "Settings action button",
            "sample_kind": "action-button",
            "sample_title": "",
            "sample_copy": "",
            "sample_button": labels["local_store_maintain_button"],
            "sample_button_class": "settings-inline-button settings-inline-button-primary",
            "sample_icon_class": "",
            "sample_icon_shell_class": "",
            "tokens": [
                raw_token("--settings-action-button-radius", "var(--radius-pill)"),
                px_token("--settings-action-button-pad-block", 0, 0),
                px_token("--settings-action-button-pad-inline", 18, 0),
                px_token("--settings-action-button-min-height", 32, 1),
                raw_token("--settings-action-button-background", "var(--theme-accent-primary)"),
                raw_token("--settings-action-button-color", "var(--color-white-adaptive)"),
                raw_token("--settings-action-button-background-disabled", "color-mix(in srgb, var(--theme-muted) 28%, transparent)"),
                raw_token("--settings-action-button-color-disabled", "color-mix(in srgb, var(--settings-action-button-color) 72%, transparent)"),
                raw_token("--settings-action-button-background-pending", "color-mix(in srgb, var(--settings-action-button-background) 76%, white 24%)"),
            ],
            "related_styles": [],
        },
        {
            "id": style_token_id("Shared select filter"),
            "name": "Shared select filter",
            "sample_kind": "shared-select-filter",
            "sample_title": "Side filter",
            "sample_copy": "The standard trigger, dropdown, selected state, and filter options shared by table headers and forms.",
            "sample_button": "All",
            "sample_button_class": "",
            "sample_icon_class": "",
            "sample_icon_shell_class": "",
            "tokens": [
                px_token("--shared-select-dropdown-padding", 10, 0),
                raw_token("--shared-select-dropdown-radius", "var(--radius-soft)"),
                raw_token("--shared-select-dropdown-max-height", "min(360px, 55vh)"),
                raw_token("--shared-select-option-padding", "9px 10px"),
                raw_token("--shared-select-option-radius", "var(--radius-pill)"),
                px_token("--shared-select-option-gap", 8, 0),
                raw_token("--control-liquid-background", "color-mix(in srgb, var(--color-white-adaptive) 0.01%, transparent)"),
                raw_token("--control-liquid-background-hover", "color-mix(in srgb, var(--theme-muted) 8%, transparent)"),
                raw_token("--control-liquid-border", "1px solid transparent"),
            ],
            "related_styles": [],
        },
        {
            "id": style_token_id("Settings action package"),
            "name": "Settings action package",
            "sample_kind": "action-package",
            "sample_title": labels["local_store_maintain_title"],
            "sample_copy": labels["local_store_maintain_note"],
            "sample_button": labels["local_store_maintain_button"],
            "sample_button_class": "settings-inline-button settings-inline-button-primary",
            "sample_icon_class": "icon-store-maintain",
            "sample_icon_shell_class": "settings-callout-card-primary",
            "tokens": [
                px_token("--settings-action-package-column-gap", 12),
                px_token("--settings-action-package-row-gap", 8),
                px_token("--settings-action-package-copy-gap", 4),
                raw_token("--settings-action-package-background", "var(--frosted-glass-background)"),
                raw_token("--settings-action-package-border", "var(--frosted-glass-border)"),
                px_token("--settings-action-package-live-marker-size", 8, 1),
                raw_token("--settings-action-package-live-marker-color", "var(--theme-accent-positive)"),
                raw_token("--settings-action-package-live-marker-duration", "1.8s"),
                px_token("--style-token-demo-width", 384),
            ],
            "related_styles": [
                {
                    "name": "Settings action button",
                    "target_id": style_token_id("Settings action button"),
                },
                {
                    "name": "Settings execution option",
                    "target_id": style_token_id("Settings execution option"),
                },
            ],
        },
        {
            "id": style_token_id("Circular icon button"),
            "name": "Circular icon button",
            "sample_kind": "round-icon-button",
            "sample_title": "",
            "sample_copy": "",
            "sample_button": "",
            "sample_button_class": "settings-round-icon-button",
            "sample_icon_class": "icon-plus",
            "sample_icon_shell_class": "",
            "tokens": [
                px_token("--settings-round-icon-button-size", 36, 1),
                px_token("--settings-round-icon-button-icon-size", 18, 1),
                raw_token("--settings-round-icon-button-radius", "var(--radius-pill)"),
                raw_token("--settings-round-icon-button-background", "var(--frosted-glass-background)"),
                raw_token("--settings-round-icon-button-background-hover", "var(--frosted-glass-background-hover)"),
                raw_token("--settings-round-icon-button-shadow", "var(--frosted-glass-shadow)"),
                raw_token("--settings-round-icon-button-shadow-hover", "var(--frosted-glass-shadow-hover)"),
                raw_token("--settings-round-icon-button-shadow-active", "var(--frosted-glass-shadow-active)"),
                raw_token("--settings-round-icon-button-color", "color-mix(in srgb, var(--theme-text) 70%, transparent)"),
                raw_token("--settings-round-icon-button-color-hover", "var(--accent-text)"),
            ],
            "related_styles": [],
        },
        {
            "id": style_token_id("Workspace article"),
            "name": "Workspace article",
            "sample_kind": "workspace-article",
            "sample_title": "General",
            "sample_copy": "Use the article shell as the desktop baseline. On narrow screens, the mobile heading surface keeps the glass material but drops the shadow before morphing toward the sidebar.",
            "sample_button": "",
            "sample_button_class": "",
            "sample_icon_class": "",
            "sample_icon_shell_class": "",
            "sample_value": "Desktop baseline",
            "tokens": [
                raw_token("--workspace-article-radius", "var(--radius-panel)"),
                px_token("--workspace-article-pad-block-start", 10, 0),
                px_token("--workspace-article-pad-inline", 12, 0),
                px_token("--workspace-article-pad-block-end", 8, 0),
                raw_token("--workspace-article-background", "var(--glass-surface-background-strong)"),
                raw_token("--workspace-article-shadow", "none"),
                raw_token("--workspace-article-blur", "var(--frosted-glass-blur)"),
                px_token("--workspace-article-heading-min-height", 44, 1),
                px_token("--workspace-article-heading-gap", 10, 0),
                raw_token("--workspace-article-heading-background", "var(--frosted-glass-background)"),
                raw_token("--workspace-article-heading-border", "none"),
                raw_token("--workspace-article-heading-shadow", "var(--frosted-glass-shadow)"),
                raw_token("--workspace-article-mobile-shadow", "none"),
                raw_token("--workspace-article-sidebar-morph-easing", "var(--motion-inertial)"),
                raw_token("--workspace-mode-result-heading-lift", "calc(var(--workspace-title-rail-height) + 8px)"),
                raw_token("--workspace-content-article-background", "transparent"),
                raw_token("--workspace-content-article-shadow", "none"),
                raw_token("--workspace-content-article-blur", "none"),
            ],
            "related_styles": [],
        },
        {
            "id": style_token_id("Workspace metric value"),
            "name": "Workspace metric value",
            "sample_kind": "metric-value",
            "sample_title": labels["portfolio_total_return"],
            "sample_copy": "",
            "sample_button": "",
            "sample_button_class": "",
            "sample_card_class": "trade-metric-card--value-align-end",
            "sample_icon_class": "",
            "sample_icon_shell_class": "",
            "sample_value": "67.01%",
            "tokens": [
                raw_token("--workspace-metric-value-font-size", "var(--font-metric-md)"),
                raw_token("--workspace-metric-value-line-height", "1"),
                raw_token("--workspace-metric-value-letter-spacing", "-0.04em"),
                raw_token("--workspace-metric-value-font-weight", "var(--font-weight-regular)"),
                raw_token("--workspace-metric-decimal-scale", "var(--font-numeric-fraction-scale)"),
                raw_token("--workspace-metric-card-padding", "6px 8px 8px"),
                px_token("--workspace-metric-card-row-gap", 4, 1),
                raw_token("--workspace-metric-card-radius", "var(--radius-panel)"),
                px_token("--workspace-metric-card-label-min-height", 24, 1),
                raw_token("--workspace-metric-card-align-self", "start"),
                raw_token("--workspace-metrics-grid-auto-rows-wide", "max-content"),
            ],
            "related_styles": [],
        },
        {
            "id": style_token_id("Portfolio donut orbit"),
            "name": "Portfolio donut orbit",
            "sample_kind": "portfolio-donut-orbit",
            "sample_title": "",
            "sample_copy": "",
            "sample_button": "",
            "sample_button_class": "",
            "sample_icon_class": "",
            "sample_icon_shell_class": "",
            "tokens": [
                px_token("--portfolio-donut-orbit-donut-size", 120, 1),
                px_token("--portfolio-donut-orbit-ring-width", 10, 1),
                px_token("--portfolio-donut-orbit-logo-size", 20, 1),
                px_token("--portfolio-donut-orbit-logo-gap", 0, 0),
                raw_token("--portfolio-donut-orbit-satellite-radius", "calc((var(--portfolio-donut-orbit-logo-size) * 1.41421356237) / 2)"),
                raw_token("--portfolio-donut-orbit-satellite-center-radius",
                          "calc((var(--portfolio-donut-orbit-donut-size) / 2) + var(--portfolio-donut-orbit-satellite-radius))"),
                raw_token("--portfolio-donut-orbit-outer-tangent-radius",
                          "calc(var(--portfolio-donut-orbit-satellite-center-radius) + var(--portfolio-donut-orbit-satellite-radius))"),
                raw_token("--portfolio-donut-orbit-frame-padding", "calc(var(--portfolio-donut-orbit-outer-tangent-radius) - (var(--portfolio-donut-orbit-donut-size) / 2))"),
                raw_token("--portfolio-donut-orbit-boundary-size", "calc(var(--portfolio-donut-orbit-outer-tangent-radius) * 2)"),
            ],
            "related_styles": [],
        },
        {
            "id": style_token_id("Scrollable data table"),
            "name": "Scrollable data table",
            "sample_kind": "data-table",
            "sample_title": "Transaction history",
            "sample_copy": "",
            "sample_button": "",
            "sample_button_class": "",
            "sample_icon_class": "",
            "sample_icon_shell_class": "",
            "sample_table_columns": ["No.", "Time", "Type", "Description", "Amount"],
            "sample_table_filter_label": "Type",
            "sample_table_filter_column_index": 2,
            "sample_table_filter_options": ["All", "Buy", "Sell"],
            "sample_table_rows": [
                ["12", "2 Apr 2026", "Buy", "NVDA @ 123.45 x 10", "$1,234.50"],
                ["11", "1 Apr 2026", "Deposit", "--", "$5,000.00"],
                ["10", "31 Mar 2026", "Dividend", "AAPL", "$42.18"],
                ["9", "28 Mar 2026", "Sell", "TSLA @ 271.00 x 3", "$813.00"],
            ],
            "tokens": [
                raw_token("--radius-panel", "10px"),
                raw_token("--glass-surface-background-soft", "var(--theme-glass-surface-background-soft)"),
                raw_token("--panel-strong", "var(--theme-panel-strong)"),
                raw_token("--scrollable-data-table-header-padding", "4px 1px"),
                raw_token("--scrollable-data-table-cell-padding", "2px 1px"),
                raw_token("--scrollable-data-table-summary-line-height", "0.75"),
                raw_token("--scrollable-data-table-summary-padding", "6px 8px"),
                px_token("--scrollable-data-table-header-height", 28, 1),
                px_token("--scrollable-data-table-min-width", 376, 1),
                raw_token("--scrollable-data-table-header-color", "var(--theme-muted)"),
                raw_token("--scrollable-data-table-scrollbar-gutter", "stable"),
                raw_token("--scrollable-data-table-row-background", "var(--panel-strong)"),
                raw_token("--scrollable-data-table-row-background-alt", "color-mix(in srgb, var(--panel-strong) 82%, var(--glass-surface-background-strong))"),
                raw_token("--scrollable-data-table-summary-background", "var(--frosted-glass-background)"),
                raw_token("--scrollable-data-table-summary-border", "var(--frosted-glass-border)"),
                raw_token("--scrollable-data-table-summary-shadow", "var(--frosted-glass-shadow)"),
                raw_token("--scrollable-data-table-summary-blur", "var(--frosted-glass-blur)"),
                raw_token("--investment-holdings-cell-padding", "4px 6px"),
            ],
            "related_styles": [],
        },
        {
            "id": style_token_id("Investment Holdings allocation badge"),
            "name": "Investment Holdings allocation badge",
            "sample_kind": "investment-holdings-allocation-badge",
            "sample_title": "",
            "sample_copy": "",
            "sample_button": "",
            "sample_button_class": "",
            "sample_icon_class": "",
            "sample_icon_shell_class": "",
            "sample_allocations": [
                {
                    "label": "Cash",
                    "amount_integer": "22,032",
                    "amount_fraction": "02",
                    "percent_integer": "30",
                    "percent_fraction": "51",
                },
                {
                    "label": "Cash equivalents",
                    "amount_integer": "32,098",
                    "amount_fraction": "02",
                    "percent_integer": "44",
                    "percent_fraction": "44",
                },
                {
                    "label": "Total equity",
                    "amount_integer": "72,224",
                    "amount_fraction": "12",
                    "percent_integer": "99",
                    "percent_fraction": "00",
                },
                {
                    "label": "1.11%",
                    "amount_integer": "1",
                    "amount_fraction": "11",
                    "percent_integer": "1",
                    "percent_fraction": "11",
                },
                {
                    "label": "8.88%",
                    "amount_integer": "8",
                    "amount_fraction": "88",
                    "percent_integer": "8",
                    "percent_fraction": "88",
                },
            ],
            "tokens": [
                px_token("--investment-holdings-allocation-badge-inline-size", 52, 1),
                raw_token("--investment-holdings-allocation-badge-glyph-width", "0.625em"),
                px_token("--investment-holdings-allocation-badge-padding-block", 2, 0),
                px_token("--investment-holdings-allocation-badge-padding-inline", 6, 0),
                px_token("--investment-holdings-allocation-badge-radius", 2, 0),
                raw_token("--investment-holdings-allocation-badge-background-positive", "var(--theme-accent-positive)"),
                raw_token("--investment-holdings-allocation-badge-background-negative", "var(--theme-accent-secondary)"),
                raw_token("--investment-holdings-allocation-badge-color", "var(--color-white-adaptive)"),
            ],
            "related_styles": [
                {
                    "name": "Scrollable data table",
                    "target_id": style_token_id("Scrollable data table"),
                },
                {
                    "name": "Workspace metric value",
                    "target_id": style_token_id("Workspace metric value"),
                },
            ],
        },
        {
            "id": style_token_id("Ticker identity row"),
            "name": "Ticker identity row",
            "sample_kind": "ticker-identity-row",
            "sample_title": "Alphabet Inc.",
            "sample_copy": "",
            "sample_button": "",
            "sample_button_class": "",
            "sample_icon_class": "",
            "sample_icon_shell_class": "",
            "sample_value": "GOOGL",
            "tokens": [
                px_token("--ticker-identity-pad-block", 4, 0),
                px_token("--ticker-identity-pad-inline", 6, 0),
                px_token("--ticker-identity-gap", 10, 0),
                px_token("--ticker-identity-min-height", 28, 1),
                px_token("--ticker-identity-logo-height", 20, 1),
                px_token("--ticker-identity-logo-max-width", 28, 1),
                raw_token("--ticker-identity-symbol-font-size", "var(--font-tooltip)"),
                px_token("--ticker-identity-name-margin-top", 2, 0),
                raw_token("--ticker-identity-name-font-size", "var(--font-ui-xs)"),
                raw_token("--ticker-identity-name-line-height", "1.2"),
                raw_token("--ticker-identity-name-fade-stop", "78%"),
                raw_token("--ticker-identity-background", "transparent"),
                raw_token("--ticker-identity-background-hover", "transparent"),
                px_token("--ticker-identity-radius", 0, 0),
            ],
            "related_styles": [],
        },
        {
            "id": style_token_id("Text input control"),
            "name": "Text input control",
            "sample_kind": "text-input-control",
            "sample_title": "Yahoo app password",
            "sample_copy": "",
            "sample_button": "",
            "sample_button_class": "",
            "sample_icon_class": "",
            "sample_icon_shell_class": "",
            "sample_placeholder": "Yahoo Mail app password",
            "sample_value": "abcd efgh ijkl mnop",
            "tokens": [
                px_token("--text-input-control-radius", 999, 0),
                px_token("--text-input-control-pad-block", 0, 0),
                px_token("--text-input-control-pad-inline", 10, 0),
                raw_token("--text-input-control-background", "transparent"),
                raw_token("--text-input-control-border", "var(--control-liquid-border)"),
                raw_token("--text-input-control-color", "var(--text)"),
                raw_token("--text-input-control-font-size", "var(--font-form-label)"),
                raw_token("--text-input-control-shadow", "none"),
                raw_token("--text-input-control-shadow-hover", "var(--control-liquid-shadow-focus)"),
            ],
            "related_styles": [],
        },
        {
            "id": style_token_id("Ticker input control"),
            "name": "Ticker input control",
            "sample_kind": "ticker-input-control",
            "sample_title": "Ticker 1",
            "sample_copy": "",
            "sample_button": "",
            "sample_button_class": "",
            "sample_icon_class": "",
            "sample_icon_shell_class": "",
            "sample_placeholder": "",
            "sample_value": "NVDA",
            "tokens": [],
            "related_styles": [
                {
                    "name": "Text input control",
                    "target_id": style_token_id("Text input control"),
                },
            ],
        },
        {
            "id": style_token_id("Settings execution option"),
            "name": "Settings execution option",
            "sample_kind": "settings-general-option",
            "sample_title": "Signal bar close",
            "sample_copy": "When a signal appears, execute the trade at the closing price of the same bar. This is simple and deterministic, but it is more optimistic because the model uses the bar that generated the signal.",
            "sample_button": "",
            "sample_button_class": "",
            "sample_icon_class": "",
            "sample_icon_shell_class": "",
            "tokens": [
                px_token("--settings-general-option-max-width", 640, 0),
                px_token("--settings-general-option-radius", 10, 0),
                px_token("--settings-general-option-pad-block", 14, 0),
                px_token("--settings-general-option-pad-inline", 16, 0),
                raw_token("--settings-general-option-background", "var(--glass-surface-background-strong)"),
                raw_token("--settings-general-option-border", "1px solid color-mix(in srgb, var(--theme-text) 8%, transparent)"),
            ],
            "related_styles": [],
        },
        {
            "id": style_token_id("Modal dialog"),
            "name": "Modal dialog",
            "sample_kind": "modal-dialog",
            "sample_title": "Saving daily market data to local cache",
            "sample_copy": "We are checking this ticker for missing daily history and saving any new data on this device. Please keep this page open while the download finishes.",
            "sample_button": "",
            "sample_button_class": "",
            "sample_icon_class": "suggestion-loading-spinner",
            "sample_icon_shell_class": "",
            "tokens": [
                px_token("--workspace-modal-radius", 10),
                px_token("--workspace-modal-pad-block", 18),
                px_token("--workspace-modal-pad-inline", 18),
                px_token("--workspace-modal-close-offset", 10),
                px_token("--workspace-modal-icon-size", 36),
                px_token("--workspace-modal-column-gap", 12),
                px_token("--workspace-modal-row-gap", 4),
                px_token("--workspace-modal-title-margin-end", 32),
            ],
            "related_styles": [],
        },
        {
            "id": style_token_id("Modal dialog banner message"),
            "name": "Modal dialog banner message",
            "sample_kind": "floating-banner",
            "sample_title": "Backtest execution model updated",
            "sample_copy": "Signal bar close",
            "sample_button": "",
            "sample_button_class": "",
            "sample_icon_class": "icon-modal-dialog-banner-backtest-execution",
            "sample_icon_shell_class": "",
            "tokens": [],
            "related_styles": [
                {
                    "name": "Modal dialog",
                    "target_id": style_token_id("Modal dialog"),
                },
            ],
        },
        {
            "id": style_token_id("Trade strategy stepper"),
            "name": "Trade strategy stepper",
            "sample_kind": "trade-strategy-stepper",
            "sample_title": "",
            "sample_copy": "",
            "sample_button": "",
            "sample_button_class": "",
            "sample_icon_class": "",
            "sample_icon_shell_class": "",
            "tokens": [
                px_token("--strategy-stepper-width", 20, 1),
                px_token("--strategy-stepper-radius", 6, 0),
                px_token("--strategy-param-control-height", 36, 1),
                px_token("--strategy-stepper-button-height", 18, 1),
                px_token("--strategy-stepper-font-size", 9, 1),
            ],
            "related_styles": [],
        },
        {
            "id": style_token_id("Local store pagination"),
            "name": "Local store pagination",
            "sample_kind": "local-store-pagination",
            "sample_title": "",
            "sample_copy": "",
            "sample_button": "",
            "sample_button_class": "",
            "sample_icon_class": "",
            "sample_icon_shell_class": "",
            "tokens": [
                px_token("--local-store-pagination-slot-size", 30, 1),
                raw_token("--local-store-pagination-button-radius", "var(--radius-pill)"),
                raw_token("--local-store-pagination-indicator-radius", "var(--radius-pill)"),
                raw_token("--local-store-pagination-indicator-background", "var(--accent-fill)"),
                raw_token("--local-store-pagination-indicator-shadow",
                          "0 8px 18px var(--accent-shadow-strong), inset 0 1px 0 color-mix(in srgb, var(--theme-glass-highlight) 36%, transparent)"),
                raw_token("--local-store-pagination-button-background", "var(--frosted-glass-background)"),
                raw_token("--local-store-pagination-button-border", "1px solid var(--accent-border-strong)"),
                raw_token("--local-store-pagination-button-shadow", "var(--frosted-glass-shadow)"),
                raw_token("--local-store-pagination-button-blur", "var(--frosted-glass-blur)"),
                raw_token("--local-store-pagination-motion-duration", "var(--motion-duration-spatial)"),
                raw_token("--local-store-pagination-motion-easing", "var(--motion-bouncy)"),
            ],
            "related_styles": [],
        },
        {
            "id": style_token_id("Chart tooltip"),
            "name": "Chart tooltip",
            "sample_kind": "chart-tooltip",
            "sample_title": "26 Mar 2026 10:08",
            "sample_copy": "",
            "sample_button": "",
            "sample_button_class": "",
            "sample_icon_class": "",
            "sample_icon_shell_class": "",
            "sample_rows": [
                {"label": "Close price", "value": "44.38", "color": "var(--accent-fill)"},
                {"label": "Net return", "value": "3.34%", "color": "var(--theme-accent-positive)"},
                {"label": "Equity", "value": "10,333.71", "color": "var(--theme-text)"},
                {"label": "If all in", "value": "9,840.88", "color": "var(--theme-muted-soft)"},
                {"label": "vs all in", "value": "+492.83", "color": "var(--theme-accent-positive)"},
            ],
            "tokens": [
                raw_token("--theme-muted-soft", "color-mix(in srgb, var(--theme-muted) 72%, var(--theme-background))"),
                material_reference_token("--tooltip-background", "Frosted glass"),
                material_reference_token("--tooltip-border", "Frosted glass"),
                material_reference_token("--tooltip-shadow", "Frosted glass"),
                material_reference_token("--tooltip-blur", "Frosted glass"),
                px_token("--chart-tooltip-min-width", 164, 1),
                px_token("--chart-tooltip-max-width", 260, 1),
                px_token("--chart-tooltip-padding-block", 10, 1),
                px_token("--chart-tooltip-padding-inline", 12, 1),
                px_token("--chart-tooltip-date-margin-bottom", 8, 1),
                raw_token("--chart-tooltip-date-align", "left"),
                px_token("--chart-tooltip-row-gap", 6, 1),
                px_token("--chart-tooltip-item-gap", 8, 1),
                raw_token("--chart-tooltip-label-align", "left"),
                raw_token("--chart-tooltip-value-align", "right"),
            ],
            "related_styles": [],
        },
    ]
    token_order = {
        "Investment community share card": 5,
        "Text input control": 10,
        "Ticker input control": 15,
        "Settings execution option": 20,
        "Segmented control": 30,
        "Workspace article": 34,
        "Workspace metric value": 35,
        "Portfolio donut orbit": 36,
        "Scrollable data table": 37,
        "Investment Holdings allocation badge": 38,
        "Settings action button": 40,
        "Settings action package": 50,
        "Circular icon button": 60,
        "Trade strategy stepper": 70,
        "Local store pagination": 80,
        "Modal dialog": 90,
        "Modal dialog banner message": 100,
        "Chart tooltip": 110,
    }
    rows.sort(key=lambda row: (token_order.get(str(row.get("name", "")), 999), str(row.get("name", ""))))
    return rows

def build_export_image_rows(project_display_url: str) -> list[dict[str, object]]:
    def export_image_id(name: str) -> str:
        return name.strip().lower().replace(" ", "-")

    def style_token_id(name: str) -> str:
        return name.strip().lower().replace(" ", "-")

    def material_token_id(name: str) -> str:
        return name.strip().lower().replace(" ", "-")

    def px_token(name: str, value: int, min_value: int = 0) -> dict[str, object]:
        return {
            "name": name,
            "value": f"{value}px",
            "editable": True,
            "numeric_value": value,
            "unit": "px",
            "min_value": min_value,
        }

    def raw_token(name: str, value: str) -> dict[str, object]:
        text_value = str(value)
        if re.fullmatch(r"-?\d+", text_value):
            numeric_value = int(text_value)
            return {
                "name": name,
                "value": text_value,
                "editable": True,
                "numeric_value": numeric_value,
                "unit": "",
                "min_value": 0,
            }
        return {
            "name": name,
            "value": text_value,
            "editable": False,
            "numeric_value": None,
            "unit": "",
            "min_value": 0,
        }

    def material_reference_token(name: str, material_name: str) -> dict[str, object]:
        return {
            "name": name,
            "value": material_name,
            "editable": False,
            "numeric_value": None,
            "unit": "",
            "min_value": 0,
            "reference_target_id": material_token_id(material_name),
            "reference_label": material_name,
        }

    return [
        {
            "id": export_image_id("Investment community share card"),
            "name": "Investment community share card",
            "sample_kind": "export-image-share-card",
            "sample_title": "Overview",
            "sample_subtitle": "",
            "sample_copy": "Exported image previews use the same token registry, HTML structure, and CSS as workspace and investment PNG exports. The print spec is a portrait card at 53.98 mm by 86.50 mm with a 3.18 mm corner radius, mapped onto a 20 px per mm export grid for readable PNG output.",
            "sample_button": "",
            "sample_button_class": "",
            "sample_icon_class": "",
            "sample_icon_shell_class": "",
            "sample_url": project_display_url,
            "sample_timestamp": "",
            "tokens": [
                raw_token("--investment-community-share-print-width", "53.98mm"),
                raw_token("--investment-community-share-print-height", "86.50mm"),
                raw_token("--investment-community-share-print-radius", "3.18mm"),
                raw_token("--investment-community-share-accent", "#0055cc"),
                px_token("--investment-community-share-shell-width", 1080, 1),
                px_token("--investment-community-share-shell-height", 1730, 1),
                raw_token("--investment-community-share-card-radius", "31.8px"),
                px_token("--investment-community-share-safe-padding", 10, 0),
                px_token("--investment-community-share-card-gap", 10, 0),
                px_token("--investment-community-share-section-gap", 10, 0),
                px_token("--investment-community-share-section-radius", 16, 0),
                px_token("--investment-community-share-footer-brand-size", 72, 0),
                px_token("--investment-community-share-footer-qr-size", 108, 0),
                px_token("--investment-community-share-ticker-identity-logo-size", 36, 1),
                material_reference_token("--investment-community-share-surface-background", "Frosted glass"),
                material_reference_token("--investment-community-share-surface-border", "Frosted glass"),
                material_reference_token("--investment-community-share-surface-shadow", "Frosted glass"),
                material_reference_token("--investment-community-share-surface-blur", "Frosted glass"),
            ],
            "related_styles": [
                {
                    "name": "Frosted glass",
                    "target_id": material_token_id("Frosted glass"),
                },
                {
                    "name": "Portfolio donut orbit",
                    "target_id": style_token_id("Portfolio donut orbit"),
                },
                {
                    "name": "Text input control",
                    "target_id": style_token_id("Text input control"),
                },
                {
                    "name": "Ticker identity row",
                    "target_id": style_token_id("Ticker identity row"),
                },
            ],
        },
    ]

def build_color_token_rows(
    theme_light: Mapping[str, object],
    theme_dark: Mapping[str, object],
) -> list[dict[str, object]]:
    def color_token_id(name: str) -> str:
        return name.strip().lower().replace(" ", "-")

    def is_hex_color(value: object) -> bool:
        return bool(re.fullmatch(r"#[0-9a-fA-F]{6}", str(value or "").strip()))

    def color_token(
        css_name: str,
        label: str,
        config_key: str,
    ) -> dict[str, object]:
        light_value = str(theme_light.get(config_key, "")).strip()
        dark_value = str(theme_dark.get(config_key, "")).strip()
        return {
            "name": css_name,
            "label": label,
            "light_value": light_value,
            "dark_value": dark_value,
            "light_is_hex": is_hex_color(light_value),
            "dark_is_hex": is_hex_color(dark_value),
        }

    def group(
        name: str,
        description: str,
        tokens: list[dict[str, object]],
    ) -> dict[str, object]:
        return {
            "id": color_token_id(name),
            "name": name,
            "description": description,
            "tokens": tokens,
        }

    return [
        group(
            "Surfaces and text",
            "The base canvas, panels, readable text, and adaptive white used by both appearances.",
            [
                color_token("--theme-background", "Background", "background"),
                color_token("--theme-panel", "Panel", "panel"),
                color_token("--theme-panel-strong", "Strong panel", "panel_strong"),
                color_token("--theme-text", "Text", "text"),
                color_token("--theme-muted", "Muted text", "muted"),
                color_token("--theme-color-white-adaptive", "Adaptive white", "color_white_adaptive"),
            ],
        ),
        group(
            "Accent colors",
            "The primary and secondary brand colors used by controls, charts, links, and emphasis.",
            [
                color_token("--theme-accent-primary", "Primary blue", "accent_primary"),
                color_token("--theme-accent-secondary", "Secondary magenta", "accent_secondary"),
            ],
        ),
        group(
            "Positive green",
            "Positive values, success states, live markers, and cash-equivalent highlights. Light and Dark intentionally use different green tokens.",
            [
                color_token("--theme-accent-positive", "Positive accent", "accent_positive"),
                color_token("--theme-success", "Success", "success"),
                color_token("--theme-success-strong", "Strong success", "success_strong"),
            ],
        ),
        group(
            "Feedback colors",
            "Error, warning, and supporting text colors for validation and operational feedback.",
            [
                color_token("--theme-error", "Error", "error"),
                color_token("--theme-error-strong", "Strong error", "error_strong"),
                color_token("--theme-warning", "Warning", "warning"),
                color_token("--theme-warning-text", "Warning text", "warning_text"),
            ],
        ),
        group(
            "Translucent colors",
            "Alpha-bearing values for feedback surfaces and glass highlights. Edit the CSS color expression directly when needed.",
            [
                color_token("--theme-error-translucent", "Translucent error", "error_translucent"),
                color_token("--theme-warning-translucent", "Translucent warning", "warning_translucent"),
                color_token("--theme-glass-highlight", "Glass highlight", "glass_highlight"),
            ],
        ),
    ]


def build_font_token_rows(labels: Mapping[str, str]) -> list[dict[str, object]]:
    def font_token_id(name: str) -> str:
        return name.strip().lower().replace(" ", "-")

    def raw_token(name: str, value: str) -> dict[str, str]:
        return {
            "name": name,
            "value": str(value),
        }

    rows = [
        {
            "id": font_token_id("Primitive scale"),
            "name": "Primitive scale",
            "description": "Base pixel sizes defined in the design system. These are the source tokens that semantic text roles inherit from.",
            "samples": [
                {"token_name": "--font-size-1", "usage_label": "Compact status", "sample_text": "Available", "sample_value": "11px"},
                {"token_name": "--font-size-2", "usage_label": "Tooltip copy", "sample_text": "Logo services reachable", "sample_value": "12px"},
                {"token_name": "--font-size-3", "usage_label": "Table text", "sample_text": "Ticker  Full name  Available range", "sample_value": "13px"},
                {"token_name": "--font-size-4", "usage_label": "Form label", "sample_text": "Ticker  Period  Reinvest cash dividends", "sample_value": "14px"},
                {"token_name": "--font-size-5", "usage_label": "Control text", "sample_text": "smtp.mail.yahoo.com", "sample_value": "15px"},
                {"token_name": "--font-size-6", "usage_label": "Section title", "sample_text": labels["hero_title"], "sample_value": "24px"},
                {"token_name": "--font-size-7", "usage_label": "Large metric", "sample_text": "+19.84%", "sample_value": "32px", "sample_kind": "numeric-fraction"},
                {"token_name": "--font-size-8", "usage_label": "XL metric", "sample_text": "67.01%", "sample_value": "36px", "sample_kind": "numeric-fraction"},
            ],
            "tokens": [
                raw_token("--font-size-1", "11px"),
                raw_token("--font-size-2", "12px"),
                raw_token("--font-size-3", "13px"),
                raw_token("--font-size-4", "14px"),
                raw_token("--font-size-5", "15px"),
                raw_token("--font-size-6", "24px"),
                raw_token("--font-size-7", "32px"),
                raw_token("--font-size-8", "36px"),
            ],
        },
        {
            "id": font_token_id("Semantic scale aliases"),
            "name": "Semantic scale aliases",
            "description": "Intermediate aliases map the primitive scale to UI, title, and metric contexts before component-level tokens consume them.",
            "samples": [
                {"token_name": "--font-ui-xs", "usage_label": "Weekday labels", "sample_text": "Sun  Mon  Tue  Wed  Thu  Fri  Sat", "sample_value": "11px"},
                {"token_name": "--font-ui-sm", "usage_label": "Tooltip size", "sample_text": "Use smtp.mail.yahoo.com:587 with STARTTLS.", "sample_value": "12px"},
                {"token_name": "--font-ui-md", "usage_label": "Standard label size", "sample_text": "Ticker  Period  Strategy", "sample_value": "14px"},
                {"token_name": "--font-ui-lg", "usage_label": "Standard control size", "sample_text": "QQQ  NVDA  AAPL", "sample_value": "15px"},
                {"token_name": "--font-title-md", "usage_label": "Workspace title", "sample_text": labels["portfolio_title"], "sample_value": "24px"},
                {"token_name": "--font-metric-md", "usage_label": "Metric medium", "sample_text": "$ 10,333.71", "sample_value": "24px", "sample_kind": "numeric-fraction"},
                {"token_name": "--font-metric-lg", "usage_label": "Metric large", "sample_text": "32.48%", "sample_value": "32px", "sample_kind": "numeric-fraction"},
                {"token_name": "--font-metric-xl", "usage_label": "Metric extra large", "sample_text": "67.01%", "sample_value": "36px", "sample_kind": "numeric-fraction"},
            ],
            "tokens": [
                raw_token("--font-ui-xs", "var(--font-size-1)"),
                raw_token("--font-ui-sm", "var(--font-size-2)"),
                raw_token("--font-ui-md", "var(--font-size-4)"),
                raw_token("--font-ui-lg", "var(--font-size-5)"),
                raw_token("--font-title-md", "var(--font-size-6)"),
                raw_token("--font-metric-md", "var(--font-size-6)"),
                raw_token("--font-metric-lg", "var(--font-size-7)"),
                raw_token("--font-metric-xl", "var(--font-size-8)"),
            ],
        },
        {
            "id": font_token_id("Component text roles"),
            "name": "Component text roles",
            "description": "These are the font tokens used directly by the current workspace screens and controls.",
            "samples": [
                {"token_name": "--font-form-label", "usage_label": "Form label",
                 "sample_text": f"{labels['backtest_ticker']}  {labels['period']}  {labels['backtest_strategy']}", "sample_value": "14px"},
                {"token_name": "--font-form-control", "usage_label": "Form control", "sample_text": "MACD crossover  |  Exact range  |  2024-01-02 to 2025-03-19",
                 "sample_value": "15px"},
                {"token_name": "--font-tooltip", "usage_label": "Tooltip", "sample_text": "Run the network checks again and refresh the availability results shown below.",
                 "sample_value": "12px"},
                {"token_name": "--font-table-body", "usage_label": "Table body", "sample_text": "2025-03-19  BUY  100 @ 187.42  |  Equity  12,845.90", "sample_value": "13px"},
                {"token_name": "--font-table-head", "usage_label": "Table head", "sample_text": "Ticker  Full name  Available range", "sample_value": "13px"},
                {"token_name": "--font-card-title", "usage_label": "Card title", "sample_text": labels["hero_title"], "sample_value": "24px"},
                {"token_name": "--font-card-subtitle", "usage_label": "Card subtitle", "sample_text": "AAPL  MSFT  NVDA  META  AVGO  AMD  ORCL  QQQ  SPY  TLT",
                 "sample_value": "15px"},
                {"token_name": "--font-metric-value", "usage_label": "Metric value", "sample_text": "67.01%", "sample_value": "24px", "sample_kind": "numeric-fraction"},
                {"token_name": "--font-numeric-fraction-scale", "usage_label": "Numeric fraction",
                 "sample_text": "62.76", "sample_value": "0.76x", "sample_kind": "numeric-fraction",
                 "preview_font_size_token": "--font-metric-value"},
            ],
            "tokens": [
                raw_token("--font-form-label", "var(--font-ui-md)"),
                raw_token("--font-form-control", "var(--font-ui-lg)"),
                raw_token("--font-tooltip", "var(--font-ui-sm)"),
                raw_token("--font-table-body", "var(--font-size-3)"),
                raw_token("--font-table-head", "var(--font-size-3)"),
                raw_token("--font-card-title", "var(--font-title-md)"),
                raw_token("--font-card-subtitle", "var(--font-ui-lg)"),
                raw_token("--font-metric-value", "var(--font-metric-md)"),
                raw_token("--font-numeric-fraction-scale", "0.76"),
            ],
        },
    ]
    return rows

def build_material_token_rows() -> list[dict[str, object]]:
    def material_token_id(name: str) -> str:
        return name.strip().lower().replace(" ", "-")

    def raw_token(name: str, value: str) -> dict[str, object]:
        return {
            "name": name,
            "value": str(value),
            "editable": False,
        }

    sample_title = "The quick brown fox jumps over the lazy dog."
    sample_copy = "Testing backdrop-filter and transparency performance over a complex gradient background."

    rows = [
        {
            "id": material_token_id("Frosted glass"),
            "name": "Frosted glass",
            "sample_kind": "glass-surface",
            "sample_title": sample_title,
            "sample_copy": sample_copy,
            "tokens": [
                raw_token("--frosted-glass-background", "var(--frosted-glass-background)"),
                raw_token("--frosted-glass-border", "var(--frosted-glass-border)"),
                raw_token("--frosted-glass-shadow", "var(--frosted-glass-shadow)"),
                raw_token("--frosted-glass-blur", "var(--frosted-glass-blur)"),
            ],
        },
    ]
    return rows
