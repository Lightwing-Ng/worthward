"""Tests for standard table and shared-filter presentation contracts. Code version: v1.0.0."""

from __future__ import annotations

from app import create_app


def test_style_tokens_expose_shared_filter_and_complete_table_contract() -> None:
    client = create_app().test_client()

    response = client.get("/settings/style-tokens")

    html = response.get_data(as_text=True)
    assert response.status_code == 200
    assert 'id="shared-select-filter"' in html
    assert "--shared-select-option-padding" in html
    assert "--scrollable-data-table-header-height" in html
    assert "--scrollable-data-table-summary-background" in html
    assert 'data-summary-scope="both"' in html


def test_investment_table_header_is_interactive_and_body_is_measurable() -> None:
    client = create_app().test_client()

    response = client.get("/trade/investment")

    html = response.get_data(as_text=True)
    assert response.status_code == 200
    assert "data-table-interactive-header" in html
    assert 'aria-label="Side"' in html
    assert "data-table-body" in html
    assert 'aria-hidden="true"' not in html.split("investment-ledger-table", 1)[1].split("</table>", 1)[0]
