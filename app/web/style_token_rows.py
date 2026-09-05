"""Pure Settings design-token presentation builders.

Code version: v1.18.0
"""

from __future__ import annotations

from collections.abc import Mapping
import re


SHARED_STYLE_TOKEN_NAMES = (
    "--backtest-surface-bottom-pad",
    "--control-glass-background-hover",
    "--control-liquid-blur",
    "--control-liquid-shadow",
    "--control-liquid-shadow-focus",
    "--demo-accent-gradient",
    "--global-quick-actions-right",
    "--layer-base",
    "--layer-chart-tooltip",
    "--layer-control-affordance",
    "--layer-decorative-backdrop",
    "--layer-fixed-dock",
    "--layer-global-popover",
    "--layer-inline-ornament",
    "--layer-inline-overlay",
    "--layer-inline-overlay-host",
    "--layer-sidebar-toggle",
    "--layer-surface-content",
    "--layout-content-width",
    "--layout-control-width",
    "--live-trading-pin-icon-size",
    "--live-trading-pin-slot-dot-size",
    "--live-trading-pin-slot-size",
    "--local-store-pagination-gap",
    "--mode-switch-thumb-shadow",
    "--motion-bouncy",
    "--motion-duration-emphasized",
    "--motion-duration-fast",
    "--motion-duration-spatial",
    "--motion-duration-standard",
    "--motion-emphasized",
    "--motion-inertial",
    "--motion-overshoot",
    "--motion-press",
    "--motion-shimmer",
    "--motion-standard",
    "--numeric-input-control-height",
    "--page-edge-pad",
    "--page-mobile-scroll-bottom-pad-base",
    "--radius-control",
    "--radius-pill",
    "--radius-soft",
    "--responsive-breakpoint-layout-switch-min",
    "--settings-action-package-max-width",
    "--settings-form-control-max-width",
    "--settings-form-control-min-width",
    "--settings-form-shell-max-width",
    "--settings-general-panel-pad",
    "--settings-reading-guard-single-column-width",
    "--settings-round-icon-button-border",
    "--settings-strategy-param-cell-pad-block",
    "--settings-strategy-param-cell-pad-inline",
    "--settings-text-input-background",
    "--settings-text-input-pad-inline",
    "--sidebar-dock-bottom-gap",
    "--sidebar-dock-hit-size",
    "--sidebar-form-control-min-height",
    "--sidebar-form-control-padding-block",
    "--sidebar-form-field-label-gap",
    "--sidebar-form-inline-gap",
    "--sidebar-form-popover-gap",
    "--sidebar-overlay-available-inline-size",
    "--sidebar-overlay-inset-bottom",
    "--sidebar-overlay-inset-left",
    "--sidebar-overlay-inset-top",
    "--sidebar-toggle-center-offset",
    "--sidebar-toggle-left",
    "--sidebar-toggle-top",
    "--sidebar-width",
    "--trade-chart-series-line-width",
    "--trade-chart-y-padding-px",
    "--workspace-article-sidebar-morph-duration",
    "--workspace-mobile-surface-bottom-pad",
    "--workspace-modal-close-center-offset",
    "--workspace-modal-close-size",
    "--workspace-title-rail-control-height",
    "--workspace-title-rail-height",
    "--workspace-title-rail-pad-block-start",
    "--workspace-title-safe-top",
)


def build_style_token_rows(
        labels: Mapping[str, str],
        foundation_token_registry: Mapping[str, object] | None = None,
) -> list[dict[str, object]]:
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

    if foundation_token_registry is None:
        from app.web.token_registry import load_foundation_css_token_registry

        foundation_token_registry = load_foundation_css_token_registry()

    def foundation_token_value(name: str) -> str:
        definition = foundation_token_registry.get(name)
        if definition is None:
            raise KeyError(f"Missing foundation style token: {name}")
        return str(getattr(definition, "value", definition))

    rows = [
        {
            "id": "collapse",
            "name": "Collapse",
            "sample_kind": "collapse",
            "sample_title": "LSTM parameters",
            "sample_fields": [
                {"label": "LSTM lookback", "value": "8", "unit": "bars"},
                {"label": "LSTM hidden size", "value": "8", "unit": "units"},
                {"label": "LSTM epochs", "value": "6", "unit": "steps"},
                {"label": "LSTM learning rate", "value": "0.050", "unit": ""},
                {"label": "Entry probability", "value": "60.0", "unit": "%"},
            ],
            "tokens": [
                px_token("--collapse-section-gap", 8),
                px_token("--collapse-icon-size", 20),
                px_token("--collapse-icon-gap", 8),
                raw_token("--collapse-icon-closed", 'url("/static/images/arrowtriangle.down.circle.svg")'),
                raw_token("--collapse-icon-open", 'url("/static/images/arrowtriangle.down.circle.fill.svg")'),
                raw_token("--collapse-summary-padding", "10px 0"),
                raw_token("--collapse-body-padding", "0 10px 10px"),
                raw_token("--collapse-font-size", "var(--font-size-5)"),
                raw_token("--collapse-font-weight", "var(--font-weight-medium)"),
            ],
            "related_styles": [],
        },
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
                material_reference_token("--segmented-control-material", "Frosted glass"),
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
            "id": style_token_id("Switch"),
            "name": "Switch",
            "sample_kind": "switch",
            "sample_title": "Reinvest cash dividends",
            "sample_copy": "",
            "sample_button": "",
            "sample_button_class": "",
            "sample_icon_class": "",
            "sample_icon_shell_class": "",
            "tokens": [
                px_token("--switch-width", 40, 1),
                px_token("--switch-height", 24, 1),
                raw_token("--switch-radius", "var(--radius-pill)"),
                raw_token("--switch-track-background", "var(--theme-glass-border)"),
                raw_token("--switch-track-background-checked", "var(--mode-switch-thumb-background)"),
                raw_token("--switch-track-shadow", "inset 0 0 0 1px var(--theme-glass-border)"),
                raw_token("--switch-track-shadow-checked", "inset 0 0 0 1px color-mix(in srgb, var(--theme-accent-primary) 14%, transparent)"),
                raw_token("--switch-track-transition", "background 220ms var(--motion-standard), box-shadow 220ms var(--motion-standard)"),
                px_token("--switch-thumb-inset", 2, 0),
                px_token("--switch-thumb-size", 20, 1),
                raw_token("--switch-thumb-radius", "50%"),
                raw_token("--switch-thumb-background", "var(--color-white-adaptive)"),
                raw_token("--switch-thumb-shadow", "inset 0 1px 0 var(--theme-glass-highlight)"),
                px_token("--switch-thumb-offset", 16, 0),
                raw_token("--switch-thumb-transition", "transform var(--motion-duration-spatial) var(--motion-bouncy), box-shadow 220ms var(--motion-standard)"),
            ],
            "related_styles": [],
        },
        {
            "id": style_token_id("Primary button"),
            "name": "Primary button",
            "sample_kind": "action-button",
            "sample_title": "",
            "sample_copy": "",
            "sample_button": labels["local_store_maintain_button"],
            "sample_button_class": "settings-inline-button settings-inline-button-primary",
            "sample_icon_class": "",
            "sample_icon_shell_class": "",
            "tokens": [
                raw_token("--primary-button-background", "var(--theme-accent-primary)"),
                raw_token("--primary-button-background-disabled", "color-mix(in srgb, var(--theme-muted) 28%, transparent)"),
                raw_token("--primary-button-background-hover", "color-mix(in srgb, var(--primary-button-background) 88%, white)"),
                raw_token("--primary-button-background-pending", "color-mix(in srgb, var(--primary-button-background) 76%, white 24%)"),
                raw_token("--primary-button-border", "0px solid transparent"),
                raw_token("--primary-button-border-hover", "0px solid transparent"),
                raw_token("--primary-button-color", "var(--color-white-adaptive)"),
                raw_token("--primary-button-color-disabled", "color-mix(in srgb, var(--primary-button-color) 72%, transparent)"),
                raw_token("--primary-button-font-weight", "var(--font-weight-medium)"),
                px_token("--primary-button-min-height", 32, 1),
                px_token("--primary-button-pad-block", 0, 0),
                px_token("--primary-button-pad-inline", 18, 0),
                raw_token("--primary-button-radius", "var(--radius-pill)"),
            ],
            "related_styles": [],
        },
        {
            "id": style_token_id("Secondary button"),
            "name": "Secondary button",
            "sample_kind": "action-button",
            "sample_title": "",
            "sample_copy": "",
            "sample_button": labels["local_store_maintain_button"],
            "sample_button_class": "secondary-button",
            "sample_icon_class": "",
            "sample_icon_shell_class": "",
            "tokens": [
                raw_token("--font-size-3", "13px"),
                raw_token("--radius-pill", "999px"),
                raw_token("--font-weight-semibold", "600"),
                raw_token("--glass-chip-background-strong", "var(--theme-glass-chip-background-strong)"),
                raw_token("--glass-chip-background-hover", "var(--theme-glass-chip-background-hover)"),
                raw_token("--glass-chip-border", "1px solid color-mix(in srgb, var(--color-white-adaptive) 24%, transparent)"),
                raw_token("--glass-chip-shadow", "0 8px 24px var(--theme-shadow-ambient), inset 0 1px 0 color-mix(in srgb, var(--theme-glass-highlight) 92%, transparent), 0 0 0 1px var(--theme-glass-highlight)"),
                raw_token("--glass-chip-shadow-hover", "0 12px 32px var(--theme-shadow-ambient), inset 0 1px 0 color-mix(in srgb, var(--theme-glass-highlight) 100%, transparent), 0 0 0 1px var(--theme-glass-highlight)"),
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
                material_reference_token("--shared-select-trigger-material", "Frosted glass"),
                px_token("--shared-select-control-height", 30, 1),
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
            "id": style_token_id("Shared select dropdown"),
            "name": "Shared select dropdown",
            "sample_kind": "shared-select-dropdown",
            "sample_title": "Period",
            "sample_copy": "The standard Period trigger and accessible option menu used by comparison and workspace forms.",
            "sample_button": "1 year",
            "sample_value": "1y",
            "sample_button_class": "",
            "sample_icon_class": "",
            "sample_icon_shell_class": "",
            "sample_options": [
                {"value": "1d", "label": "1 day"},
                {"value": "3d", "label": "3 days"},
                {"value": "1w", "label": "1 week"},
                {"value": "1mo", "label": "1 month"},
                {"value": "3mo", "label": "3 months"},
                {"value": "6mo", "label": "6 months"},
                {"value": "1y", "label": "1 year"},
                {"value": "2y", "label": "2 years"},
                {"value": "3y", "label": "3 years"},
                {"value": "5y", "label": "5 years"},
                {"value": "10y", "label": "10 years"},
                {"value": "max", "label": "Max"},
            ],
            "tokens": [
                material_reference_token("--shared-select-dropdown-material", "Frosted glass"),
            ],
            "related_styles": [
                {
                    "name": "Shared select filter",
                    "target_id": style_token_id("Shared select filter"),
                },
            ],
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
                material_reference_token("--settings-action-package-material", "Frosted glass"),
                px_token("--settings-action-package-column-gap", 12),
                px_token("--settings-action-package-row-gap", 8),
                px_token("--settings-action-package-copy-gap", 4),
                raw_token("--settings-action-package-background", "var(--frosted-glass-background)"),
                raw_token("--settings-action-package-border", "var(--frosted-glass-border)"),
                px_token("--settings-action-package-live-marker-size", 8, 1),
                raw_token("--settings-action-package-live-marker-color", "var(--theme-accent-positive)"),
                raw_token("--settings-action-package-live-marker-duration", "1.8s"),
                raw_token("--style-token-demo-width", "var(--layout-control-width)"),
            ],
            "related_styles": [
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
                material_reference_token("--settings-round-icon-button-material", "Frosted glass"),
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
            "id": style_token_id("Scrollable table"),
            "name": "Scrollable table",
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
            "sample_table_page_size": 6,
            "sample_table_rows": [
                ["12", "2 Apr 2026", "Buy", "NVDA @ 123.45 x 10", "$1,234.50"],
                ["11", "1 Apr 2026", "Deposit", "--", "$5,000.00"],
                ["10", "31 Mar 2026", "Dividend", "AAPL", "$42.18"],
                ["9", "28 Mar 2026", "Sell", "TSLA @ 271.00 x 3", "$813.00"],
                ["8", "27 Mar 2026", "Buy", "MSFT @ 410.00 x 2", "$820.00"],
                ["7", "26 Mar 2026", "Buy", "AAPL @ 172.00 x 3", "$516.00"],
                ["6", "25 Mar 2026", "Sell", "GOOGL @ 150.00 x 4", "$600.00"],
                ["5", "24 Mar 2026", "Deposit", "--", "$2,500.00"],
                ["4", "23 Mar 2026", "Dividend", "NVDA", "$18.40"],
                ["3", "22 Mar 2026", "Buy", "AMD @ 180.00 x 2", "$360.00"],
                ["2", "21 Mar 2026", "Sell", "AMZN @ 175.00 x 1", "$175.00"],
                ["1", "20 Mar 2026", "Buy", "META @ 490.00 x 1", "$490.00"],
            ],
            "tokens": [
                material_reference_token("--scrollable-data-table-header-material", "Frosted glass"),
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
                    "name": "Scrollable table",
                    "target_id": style_token_id("Scrollable table"),
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
            "tokens": [raw_token("--ticker-input-font-size", "var(--font-size-5)")],
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
                raw_token("--settings-general-option-max-width", "var(--layout-content-width)"),
                raw_token("--settings-general-option-radius", "var(--radius-soft)"),
                px_token("--settings-general-option-pad-block", 14, 0),
                px_token("--settings-general-option-pad-inline", 16, 0),
                raw_token("--settings-general-option-background", "var(--glass-surface-background-strong)"),
                raw_token("--settings-general-option-border", "0.5px solid color-mix(in srgb, var(--theme-text) 8%, transparent)"),
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
                material_reference_token("--workspace-modal-material", "Frosted glass"),
                raw_token("--workspace-modal-radius", "var(--radius-panel)"),
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
            "tokens": [
                material_reference_token("--notice-floating-material", "Frosted glass"),
            ],
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
                raw_token("--strategy-stepper-radius", "var(--radius-soft)"),
                px_token("--strategy-param-control-height", 30, 1),
                px_token("--strategy-stepper-button-height", 18, 1),
                px_token("--strategy-stepper-font-size", 9, 1),
            ],
            "related_styles": [],
        },
        {
            "id": style_token_id("Pagination"),
            "name": "Pagination",
            "sample_kind": "local-store-pagination",
            "sample_title": "",
            "sample_copy": "",
            "sample_button": "",
            "sample_button_class": "",
            "sample_icon_class": "",
            "sample_icon_shell_class": "",
            "tokens": [
                px_token("--local-store-pagination-slot-size", 30, 1),
                material_reference_token("--local-store-pagination-material", "Frosted glass"),
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
            "id": style_token_id("Tooltip"),
            "name": "Tooltip",
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
    for row in rows:
        row["tokens"] = sorted(
            row.get("tokens", []),
            key=lambda token: str(token.get("name", "")).casefold(),
        )
        row["related_styles"] = sorted(
            row.get("related_styles", []),
            key=lambda related_style: str(related_style.get("name", "")).casefold(),
        )
    rows.sort(key=lambda row: str(row.get("name", "")).casefold())
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
