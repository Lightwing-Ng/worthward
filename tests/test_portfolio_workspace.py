"""Portfolio allocation and missing-dataset route regressions.

Code version: v1.0.0
"""

from __future__ import annotations

import json
from pathlib import Path
import re
from tempfile import TemporaryDirectory
import unittest
from typing import Any
from unittest.mock import patch

from app import create_app
from tests.factories.market import close_frame_for_ticker, quote_profile_stub


def _read_bootstrap_state(body: str) -> dict[str, Any]:
    match = re.search(
        r'<script id="worthward_state" type="application/json">(.*?)</script>',
        body,
        flags=re.DOTALL,
    )
    if match is None:
        raise AssertionError("Worthward bootstrap state was not rendered.")
    return json.loads(match.group(1))


class PortfolioWorkspaceTests(unittest.TestCase):
    def _get_portfolio(
            self,
            url: str,
            *,
            missing_ticker: str | None = None,
            local_tickers: list[str] | None = None,
    ):
        def fetch_history(ticker: str, _include_dividends: bool, **_kwargs: object):
            if ticker == missing_ticker:
                raise ValueError(f"No market data returned for {ticker}.")
            return close_frame_for_ticker(ticker)

        with TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            for ticker in local_tickers or []:
                (temp_root / f"{ticker}.parquet").write_bytes(b"test-history-present")
            with (
                patch("app.web.runtime.ensure_latest_daily_caches", return_value=[]),
                patch("app.web.runtime.fetch_history", side_effect=fetch_history),
                patch(
                    "app.web.runtime.history_store_path_for",
                    side_effect=lambda ticker: temp_root / f"{ticker}.parquet",
                ),
                patch(
                    "app.web.runtime.list_local_tickers",
                    return_value=list(local_tickers or []),
                ),
                patch("app.web.runtime.has_profile_record", return_value=True),
                patch("app.web.runtime.has_logo_asset", return_value=True),
                patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
                patch("app.web.runtime.record_ticker_usage"),
            ):
                return create_app().test_client().get(url)

    def test_missing_middle_ticker_replacement_preserves_dataset_and_weight_slots(self) -> None:
        response = self._get_portfolio(
            "/workspaces/portfolio"
            "?ticker=QQQ&ticker=MISS&ticker=AAPL"
            "&weight=20&weight=30&weight=50&period=1y",
            missing_ticker="MISS",
            local_tickers=["QQQ", "NVDA", "AAPL"],
        )

        self.assertEqual(response.status_code, 200)
        state = _read_bootstrap_state(response.get_data(as_text=True))
        items = state["portfolio"]["items"]
        self.assertEqual(
            [(item["ticker"], item["weight"], item["initial_price"]) for item in items],
            [("QQQ", 20, 100.0), ("NVDA", 30, 300.0), ("AAPL", 50, 200.0)],
        )
        self.assertIn(
            "MISS has no local or remote market data, automatically replaced with NVDA.",
            response.get_data(as_text=True),
        )

    def test_numbered_share_values_follow_their_non_empty_ticker_slots(self) -> None:
        response = self._get_portfolio(
            "/workspaces/portfolio"
            "?ticker_1=QQQ&ticker_2=&ticker_3=AAPL"
            "&allocation=shares&shares_1=1&shares_2=99&shares_3=3&period=1y"
        )

        self.assertEqual(response.status_code, 200)
        state = _read_bootstrap_state(response.get_data(as_text=True))
        portfolio = state["portfolio"]
        self.assertEqual(
            [(item["ticker"], item["shares"]) for item in portfolio["items"]],
            [("QQQ", 1), ("AAPL", 3)],
        )
        self.assertEqual(portfolio["weights"], [14, 86])


if __name__ == "__main__":
    unittest.main()
