"""Shared ownership of repeated Settings and Backtest DOM structures.

Code version: v1.0.0
"""

from __future__ import annotations

import json
from pathlib import Path
import re

from app import create_app
from app.web.backtest_table_columns import (
    BACKTEST_TRANSACTION_COLUMNS,
    backtest_transaction_columns,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_ROOT = PROJECT_ROOT / "app/web/templates"
HYDRATION_SOURCE = (
    PROJECT_ROOT / "app/web/static/assets/js/app/workspace-hydration.js"
)
TOKEN_TABLE_PARTIALS = (
    "settings/_style_tokens.html",
    "settings/_export_image.html",
)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_one_macro_owns_the_settings_token_table_body() -> None:
    macros = _read(TEMPLATE_ROOT / "_macros.html")
    assert macros.count("{% macro render_style_token_table(") == 1
    assert macros.count('<table class="style-token-table"') == 1

    for relative_path in TOKEN_TABLE_PARTIALS:
        source = _read(TEMPLATE_ROOT / relative_path)
        assert "{{ render_style_token_table(row) }}" in source, relative_path
        assert '<table class="style-token-table"' not in source, relative_path
        assert "style-token-related-row" not in source, relative_path
        assert (
            '{% from "_macros.html" import render_style_token_table with context %}'
            in source
        ), relative_path


def test_settings_token_tables_still_render_editable_and_reference_rows() -> None:
    client = create_app().test_client()

    for section in ("style-tokens", "export-image"):
        html = client.get(f"/settings/{section}").get_data(as_text=True)
        assert '<table class="style-token-table"' in html, section
        assert "style-token-value-control" in html, section
        assert 'data-style-token-stepper="up"' in html, section
        assert "style-token-related-row" in html, section


def test_one_python_definition_owns_the_backtest_transaction_columns() -> None:
    backtest_template = _read(TEMPLATE_ROOT / "backtest.html")
    macros = _read(TEMPLATE_ROOT / "_macros.html")

    assert "render_backtest_transaction_colgroup" in backtest_template
    assert "render_backtest_transaction_header" in backtest_template
    assert "--backtest-col-no-width" not in backtest_template
    assert "--backtest-col-no-width" not in _read(HYDRATION_SOURCE)
    assert macros.count("{% macro render_backtest_transaction_colgroup(") == 1
    assert macros.count("{% macro render_backtest_transaction_header(") == 1

    assert "WORTHWARD_BACKTEST_COLUMNS" in _read(HYDRATION_SOURCE)
    assert "backtestColumnColgroup" in _read(HYDRATION_SOURCE)
    assert "backtestColumnHeader" in _read(HYDRATION_SOURCE)


def test_multi_asset_variant_adds_only_the_ticker_column() -> None:
    single = backtest_transaction_columns()
    multi = backtest_transaction_columns(multi_asset=True)

    assert [column["key"] for column in single] == [
        column.key for column in BACKTEST_TRANSACTION_COLUMNS if not column.multi_asset_only
    ]
    assert [column["key"] for column in multi] == [
        column.key for column in BACKTEST_TRANSACTION_COLUMNS
    ]
    assert multi[2]["key"] == "ticker"
    assert single[0]["label"] == "No."
    assert single[-1]["label"] == "Equity"


def test_every_page_publishes_the_same_backtest_column_payload() -> None:
    client = create_app().test_client()
    html = client.get("/settings/style-tokens").get_data(as_text=True)

    payload_match = re.search(
        r'<script id="worthward_backtest_columns" type="application/json">(.*?)</script>',
        html,
        re.DOTALL,
    )
    assert payload_match is not None
    payload = json.loads(payload_match.group(1))

    assert payload["single"] == backtest_transaction_columns()
    assert payload["multiAsset"] == backtest_transaction_columns(multi_asset=True)


def test_shared_macros_render_the_same_column_order_as_the_definition() -> None:
    app = create_app()
    columns = backtest_transaction_columns(multi_asset=True)
    with app.test_request_context():
        macros = app.jinja_env.get_template("_macros.html").module
        colgroup = str(macros.render_backtest_transaction_colgroup(columns))
        header = str(macros.render_backtest_transaction_header(columns))

    assert re.findall(r"var\((--backtest-col-[a-z-]+-width)\)", colgroup) == [
        column["widthToken"] for column in columns
    ]
    assert re.findall(r'data-markdown-export-label="([^"]+)"', header) == [
        column["label"].replace("&", "&amp;") for column in columns
    ]


def test_pending_hydration_skeleton_exposes_no_fabricated_financial_value() -> None:
    source = _read(HYDRATION_SOURCE)

    # The skeleton uses a neutral pending placeholder, never a priced figure.
    assert 'class="trade-metric-value is-pending-value"' in source
    assert "is-pending-value" in source
    assert "escapeHtmlText" in source
