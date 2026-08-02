"""
Investment money-market default configuration tests.

Code version: v0.6.0
"""

from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from app import create_app
from app.core.settings import get_settings


def test_hong_kong_money_market_funds_use_canonical_isins_and_quote_currencies() -> None:
    investment_settings = get_settings()["investment"]
    money_market_funds = investment_settings["money_market_funds"]

    assert {
        "HK0000369196",
        "HK0000584737",
        "HK0000584752",
        "HK0000478872",
        "HK0000720752",
        "HK0001039582",
    }.issubset(money_market_funds["tickers"])
    assert money_market_funds["quote_currency_overrides"] == {
        "005276756": "USD",
        "HK0000369196": "USD",
        "HK0000584737": "USD",
        "HK0000584752": "USD",
        "HK0000478872": "HKD",
        "HK0000720752": "USD",
        "HK0001039582": "USD",
    }


def test_investment_api_exposes_the_usd_money_market_currency_override() -> None:
    with TemporaryDirectory() as temp_dir:
        store_path = Path(temp_dir) / "investment.parquet"
        cache_path = Path(temp_dir) / "transactions_payload.json"
        with (
            patch("app.web.runtime.INVESTMENT_STORE_PATH", store_path),
            patch("app.web.runtime.INVESTMENT_TRANSACTIONS_CACHE_PATH", cache_path),
        ):
            response = create_app().test_client().get("/api/investment/transactions")

    assert response.status_code == 200
    assert response.get_json()["money_market_quote_currencies"] == {
        "005276756": "USD",
        "HK0000369196": "USD",
        "HK0000584737": "USD",
        "HK0000584752": "USD",
        "HK0000478872": "HKD",
        "HK0000720752": "USD",
        "HK0001039582": "USD",
    }
