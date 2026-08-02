"""
Investment API known-company-name fallback contract tests.

Code version: v0.2.0
"""

from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from app import create_app


def test_investment_api_exposes_core_holdings_names_without_remote_profiles() -> None:
    expected_names = {
        "005276756": "Franklin Templeton U.S. Dollar Short-Term Money Market Fund",
        "HIBS.US": "Direxion Daily S&P 500 High Beta Bear 3X Shares ETF",
        "DIS.US": "The Walt Disney Company",
        "KO.US": "The Coca-Cola Company",
        "V.US": "Visa Inc.",
        "AXP.US": "American Express Company",
        "CVX.US": "Chevron Corporation",
        "C.US": "Citigroup Inc.",
        "BAC.US": "Bank of America Corporation",
        "JPM.US": "JPMorgan Chase & Co.",
        "AMZN.US": "Amazon.com, Inc.",
        "GS.US": "The Goldman Sachs Group, Inc.",
        "VZ.US": "Verizon Communications Inc.",
        "WFC.US": "Wells Fargo & Company",
        "SQQQ.US": "ProShares UltraPro Short QQQ",
        "EQNR.US": "Equinor ASA",
    }
    with TemporaryDirectory() as temp_dir:
        store_path = Path(temp_dir) / "investment.parquet"
        cache_path = Path(temp_dir) / "transactions_payload.json"
        with (
            patch("app.web.runtime.INVESTMENT_STORE_PATH", store_path),
            patch("app.web.runtime.INVESTMENT_TRANSACTIONS_CACHE_PATH", cache_path),
        ):
            response = create_app().test_client().get("/api/investment/transactions")

    assert response.status_code == 200
    names = response.get_json()["known_ticker_company_names"]
    for ticker, expected_name in expected_names.items():
        assert names[ticker] == expected_name
