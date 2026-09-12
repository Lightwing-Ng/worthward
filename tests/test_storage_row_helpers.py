"""Tests for canonical persistence row adapters.

Code version: v1.1.0
"""

from __future__ import annotations

import pandas as pd

from app.infrastructure.storage import (
    _profile_row_to_record,
    _search_cache_row_to_item,
)


def test_profile_row_adapter_normalizes_optional_and_provider_fields() -> None:
    record = _profile_row_to_record(
        {
            "ticker": "",
            "company_name": "  Example Corp  ",
            "website": " ",
            "storage_scope": "unexpected",
            "tradingview_screener": "  AMERICA  ",
            "tradingview_exchange": " nasdaq ",
            "updated_at": "2026-09-12T00:00:00Z",
        },
        "EXMPL",
    )

    assert record == {
        "ticker": "EXMPL",
        "company_name": "Example Corp",
        "website": None,
        "storage_scope": "search_cache",
        "tradingview_screener": "america",
        "tradingview_exchange": "NASDAQ",
        "updated_at": "2026-09-12T00:00:00Z",
    }


def test_search_cache_row_adapter_has_one_defaulting_contract() -> None:
    assert _search_cache_row_to_item(
        {
            "symbol": "aapl",
            "name": " Apple ",
            "asset_type": None,
            "logo_url": " ",
            "source": "",
        }
    ) == {
        "symbol": "AAPL",
        "name": "Apple",
        "asset_type": "",
        "logo_url": "",
        "source": "remote",
    }


def test_persistence_row_adapters_accept_dataframe_series() -> None:
    profile = pd.Series(
        {
            "ticker": "MSFT",
            "company_name": "Microsoft Corporation",
            "website": "https://www.microsoft.com",
            "storage_scope": "local_store",
            "tradingview_screener": "america",
            "tradingview_exchange": "NASDAQ",
            "updated_at": "2026-09-12T00:00:00Z",
        }
    )
    search_item = pd.Series(
        {
            "symbol": "msft",
            "name": "Microsoft Corporation",
            "asset_type": "stock",
            "logo_url": "/logos/MSFT.svg",
            "source": "local",
        }
    )

    assert _profile_row_to_record(profile, "FALLBACK") == {
        "ticker": "MSFT",
        "company_name": "Microsoft Corporation",
        "website": "https://www.microsoft.com",
        "storage_scope": "local_store",
        "tradingview_screener": "america",
        "tradingview_exchange": "NASDAQ",
        "updated_at": "2026-09-12T00:00:00Z",
    }
    assert _search_cache_row_to_item(search_item) == {
        "symbol": "MSFT",
        "name": "Microsoft Corporation",
        "asset_type": "stock",
        "logo_url": "/logos/MSFT.svg",
        "source": "local",
    }
