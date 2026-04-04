"""
Tests for logo provider ticker normalization.

Code version: v0.3.0
"""

from __future__ import annotations

from pathlib import Path
import unittest
from unittest.mock import patch

import pandas as pd

from app import create_app
from app.infrastructure.storage import (
    clear_nonhistorical_market_cache,
    history_store_path_for,
    intraday_history_store_path_for,
    logo_store_path_for,
)
from app.services.logos import (
    build_logo_provider_ticker_candidates,
    fetch_quote_profile,
    search_tickers,
)


class LogoServiceTests(unittest.TestCase):
    def test_build_logo_provider_ticker_candidates_supports_share_class_spacing(self) -> None:
        candidates = build_logo_provider_ticker_candidates("BRK B")

        self.assertEqual(candidates[0], "BRK-B")
        self.assertIn("BRK.B", candidates)
        self.assertIn("BRK B", candidates)

    def test_store_paths_canonicalize_share_class_spacing(self) -> None:
        self.assertEqual(history_store_path_for("BRK B").name, "BRK-B.parquet")
        self.assertEqual(logo_store_path_for("BRK B").name, "BRK-B.png")

    def test_store_paths_canonicalize_share_class_dot_notation(self) -> None:
        self.assertEqual(history_store_path_for("BRK.B").name, "BRK-B.parquet")
        self.assertEqual(logo_store_path_for("BRK.B").name, "BRK-B.png")

    def test_search_tickers_returns_local_prefix_matches_with_logo_urls(self) -> None:
        ticker = "ONDS"
        history_path = history_store_path_for(ticker)
        logo_path = logo_store_path_for(ticker)
        original_history = history_path.read_bytes() if history_path.exists() else None
        original_logo = logo_path.read_bytes() if logo_path.exists() else None

        try:
            history_path.parent.mkdir(parents=True, exist_ok=True)
            pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2026-04-01"]),
                    "Close": [1.23],
                }
            ).to_parquet(history_path, index=False)
            logo_path.parent.mkdir(parents=True, exist_ok=True)
            logo_path.write_bytes(b"fake-logo")

            with create_app().test_request_context():
                results = search_tickers("ON", limit=5)
            onds_item = next((item for item in results if item["symbol"] == ticker), None)

            self.assertIsNotNone(onds_item)
            assert onds_item is not None
            self.assertIn(onds_item["source"], {"local", "recent"})
            self.assertIn(f"/market-store/logos/{ticker}.png", onds_item["logo_url"])
        finally:
            if original_history is None:
                if history_path.exists():
                    history_path.unlink()
            else:
                history_path.write_bytes(original_history)
            if original_logo is None:
                if logo_path.exists():
                    logo_path.unlink()
            else:
                logo_path.write_bytes(original_logo)

    def test_search_tickers_excludes_intraday_store_suffix_from_local_suggestions(self) -> None:
        ticker = "MU"
        history_path = history_store_path_for(ticker)
        intraday_path = intraday_history_store_path_for(ticker, "1m")
        logo_path = logo_store_path_for(ticker)
        original_history = history_path.read_bytes() if history_path.exists() else None
        original_intraday = intraday_path.read_bytes() if intraday_path.exists() else None
        original_logo = logo_path.read_bytes() if logo_path.exists() else None

        try:
            history_path.parent.mkdir(parents=True, exist_ok=True)
            pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2026-04-01"]),
                    "Close": [101.23],
                }
            ).to_parquet(history_path, index=False)
            pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2026-04-01 09:30"]),
                    "Close": [101.25],
                }
            ).to_parquet(intraday_path, index=False)
            logo_path.parent.mkdir(parents=True, exist_ok=True)
            logo_path.write_bytes(b"fake-logo")

            with create_app().test_request_context():
                results = search_tickers("M", limit=10)

            symbols = [item["symbol"] for item in results]
            self.assertIn("MU", symbols)
            self.assertNotIn("MU_1M", symbols)
        finally:
            if original_history is None:
                if history_path.exists():
                    history_path.unlink()
            else:
                history_path.write_bytes(original_history)
            if original_intraday is None:
                if intraday_path.exists():
                    intraday_path.unlink()
            else:
                intraday_path.write_bytes(original_intraday)
            if original_logo is None:
                if logo_path.exists():
                    logo_path.unlink()
            else:
                logo_path.write_bytes(original_logo)

    def test_fetch_quote_profile_uses_roundhill_domain_fallback_for_new_etf_logo(self) -> None:
        with create_app().test_request_context():
            with patch("app.services.logos.load_profile_record", return_value=None), \
                    patch("app.services.logos.has_remote_market_access", return_value=True), \
                    patch("app.services.logos.yf.Ticker") as ticker_mock, \
                    patch(
                        "app.services.logos.upsert_profile_record",
                        return_value={
                            "ticker": "DRAM",
                            "company_name": "Roundhill Memory ETF",
                            "website": "https://www.roundhillinvestments.com",
                        },
                    ), \
                    patch("app.services.logos.fetch_remote_logo_bytes", return_value=b"roundhill-logo") as fetch_logo_mock:
                ticker_mock.return_value.info = {
                    "longName": "Roundhill Memory ETF",
                    "website": None,
                }

                profile = fetch_quote_profile("DRAM", force_refresh=True)

        self.assertEqual(profile.company_name, "Roundhill Memory ETF")
        self.assertEqual(profile.website, "https://www.roundhillinvestments.com")
        self.assertIn("/market-store/logos/DRAM.png", profile.logo_url or "")
        fetch_logo_mock.assert_called_once_with("DRAM", "roundhillinvestments.com")

    def test_clear_nonhistorical_market_cache_keeps_configured_money_market_logo(self) -> None:
        protected_logo_path = logo_store_path_for("005276756")
        removed_logo_path = logo_store_path_for("ZZZTEST")
        original_protected_logo = protected_logo_path.read_bytes() if protected_logo_path.exists() else None
        original_removed_logo = removed_logo_path.read_bytes() if removed_logo_path.exists() else None

        try:
            protected_logo_path.parent.mkdir(parents=True, exist_ok=True)
            protected_logo_path.write_bytes(b"protected-logo")
            removed_logo_path.parent.mkdir(parents=True, exist_ok=True)
            removed_logo_path.write_bytes(b"removed-logo")

            summary = clear_nonhistorical_market_cache()

            self.assertTrue(protected_logo_path.exists())
            self.assertFalse(removed_logo_path.exists())
            self.assertGreaterEqual(summary["protected_tickers"], 1)
            self.assertGreaterEqual(summary["removed_logos"], 1)
        finally:
            if original_protected_logo is None:
                if protected_logo_path.exists():
                    protected_logo_path.unlink()
            else:
                protected_logo_path.write_bytes(original_protected_logo)
            if original_removed_logo is None:
                if removed_logo_path.exists():
                    removed_logo_path.unlink()
            else:
                removed_logo_path.write_bytes(original_removed_logo)


if __name__ == "__main__":
    unittest.main()
