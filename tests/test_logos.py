"""
Tests for logo provider ticker normalization.

Code version: v0.5.0
"""

from __future__ import annotations

from pathlib import Path
import unittest
from unittest.mock import patch

import pandas as pd

from app import create_app
from app.infrastructure.storage import (
    clear_non_historical_market_cache,
    history_store_path_for,
    intraday_history_store_path_for,
    logo_store_path_for,
)
from app.services.logos import (
    _load_yfinance_ticker_info,
    _search_yfinance_quotes,
    _build_local_suggestion,
    build_logo_provider_ticker_candidates,
    build_quote_profile_payload,
    fetch_and_store_logo,
    fetch_quote_profile,
    quote_lookup_symbol,
    refresh_logo_store,
    resolve_stored_logo_url,
    search_tickers,
)


class LogoServiceTests(unittest.TestCase):
    def test_yfinance_search_reuses_shared_verified_session(self) -> None:
        shared_session = object()
        with patch(
            "app.services.logos.get_yfinance_session",
            return_value=shared_session,
        ), patch("app.services.logos.yf.Search") as search_mock:
            search_mock.return_value.quotes = [{"symbol": "ADBE"}]

            quotes = _search_yfinance_quotes("ADBE")

        self.assertEqual(quotes, [{"symbol": "ADBE"}])
        search_mock.assert_called_once_with(
            "ADBE",
            max_results=20,
            news_count=0,
            lists_count=0,
            recommended=0,
            raise_errors=False,
            session=shared_session,
        )

    def test_yfinance_ticker_profile_reuses_shared_verified_session(self) -> None:
        shared_session = object()
        with patch(
            "app.services.logos.get_yfinance_session",
            return_value=shared_session,
        ), patch("app.services.logos.yf.Ticker") as ticker_mock:
            ticker_mock.return_value.info = {"symbol": "ADBE"}

            info = _load_yfinance_ticker_info("ADBE")

        self.assertEqual(info, {"symbol": "ADBE"})
        ticker_mock.assert_called_once_with("ADBE", session=shared_session)

    def test_unconfigured_search_certificate_failure_logs_ca_guidance(self) -> None:
        failure = (
            "Failed to perform, curl: (60) SSL certificate problem: self signed "
            "certificate in certificate chain at https://user:contact@example.invalid/"
            "?token=private"
        )
        with patch(
            "app.infrastructure.runtime_network._YFINANCE_ENTERPRISE_CA_PATH",
            None,
        ), patch(
            "app.services.logos.ensure_market_store_dir",
        ), patch(
            "app.services.logos.top_used_tickers",
            return_value=[],
        ), patch(
            "app.services.logos.build_local_alias_search_items",
            return_value=[],
        ), patch(
            "app.services.logos.build_local_search_items",
            return_value=[],
        ), patch(
            "app.services.logos.load_search_cache_items",
            return_value=[],
        ), patch(
            "app.services.logos.has_remote_market_access",
            return_value=True,
        ), patch(
            "app.services.logos._search_yfinance_quotes",
            side_effect=ConnectionError(failure),
        ), self.assertLogs("app.services.logos", level="WARNING") as captured:
            results = search_tickers("ADBE")

        message = " ".join(captured.output)
        self.assertEqual(results, [])
        self.assertIn("ANTIGRAVITY_YAHOO_CA_PEM", message)
        self.assertIn("[network].yahoo_ca_pem", message)
        self.assertNotIn("user:password", message)
        self.assertNotIn("private", message)

    def test_local_sk_hynix_suggestion_replaces_symbol_only_profile_name(self) -> None:
        fallback_record = {
            "ticker": "SKHY",
            "company_name": "SKHY",
            "website": "https://www.skhynix.com",
        }
        with patch("app.services.logos.has_profile_record", return_value=True), \
                patch("app.services.logos.has_logo_asset", return_value=False), \
                patch("app.services.logos.load_profile_record", return_value=fallback_record):
            suggestion = _build_local_suggestion("SKHY", query="SKHY", seen=set())

        self.assertIsNotNone(suggestion)
        self.assertEqual(suggestion["symbol"], "SKHY")
        self.assertEqual(suggestion["name"], "SK hynix Inc.")

    def test_known_sk_hynix_profile_skips_remote_yfinance_lookup(self) -> None:
        for cached_record in (
            None,
            {
                "ticker": "SKHY",
                "company_name": "SKHY",
                "website": None,
                "updated_at": "2026-07-14T00:00:00+00:00",
            },
        ):
            with self.subTest(cached_record=cached_record):
                with patch("app.services.logos.load_profile_record", return_value=cached_record), \
                        patch(
                            "app.services.logos.resolve_logo_url_with_fallback",
                            return_value="/market-store/logos/000660.KS.svg",
                        ), \
                        patch("app.services.logos._load_yfinance_ticker_info") as info_mock, \
                        patch("app.services.logos.has_remote_market_access") as remote_access_mock:
                    profile = fetch_quote_profile("SKHY", force_refresh=False)

                self.assertEqual(profile.ticker, "SKHY")
                self.assertEqual(profile.company_name, "SK hynix Inc.")
                self.assertEqual(profile.website, "https://www.skhynix.com")
                self.assertEqual(profile.logo_url, "/market-store/logos/000660.KS.svg")
                info_mock.assert_not_called()
                remote_access_mock.assert_not_called()

    def test_cached_named_profile_skips_remote_connectivity_probe(self) -> None:
        cached_record = {
            "ticker": "SKHYV",
            "company_name": "SK hynix Inc.",
            "website": "https://www.skhynix.com",
            "updated_at": "2000-01-01T00:00:00+00:00",
        }
        with patch("app.services.logos.load_profile_record", return_value=cached_record), \
                patch("app.services.logos.resolve_logo_url_with_fallback", return_value="/market-store/logos/000660.KS.svg"), \
                patch("app.services.logos.has_remote_market_access") as remote_access_mock:
            profile = fetch_quote_profile("SKHYV", force_refresh=False)

        self.assertEqual(profile.company_name, "SK hynix Inc.")
        remote_access_mock.assert_not_called()

    def test_sk_hynix_us_symbols_reuse_korean_primary_listing_logo(self) -> None:
        with create_app().test_request_context():
            with patch("app.services.logos.resolve_logo_store_path") as resolve_mock:
                resolve_mock.side_effect = lambda ticker: (
                    Path("/tmp/000660.KS.svg")
                    if ticker == "000660.KS"
                    else None
                )
                with patch.object(Path, "stat") as stat_mock:
                    stat_mock.return_value.st_mtime_ns = 123
                    for ticker in ("SKHYV", "SKHY"):
                        with self.subTest(ticker=ticker):
                            self.assertIn(
                                "/market-store/logos/000660.KS.svg",
                                resolve_stored_logo_url(ticker),
                            )

    def test_sk_hynix_alias_logo_bypasses_remote_refresh(self) -> None:
        with patch(
            "app.services.logos.resolve_stored_logo_url",
            return_value="/market-store/logos/000660.KS.svg?v=123",
        ), patch("app.services.logos.refresh_logo_store") as refresh_mock:
            logo_url = fetch_and_store_logo("SKHYV", None)

        self.assertEqual(logo_url, "/market-store/logos/000660.KS.svg?v=123")
        refresh_mock.assert_not_called()

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

    def test_quote_lookup_symbol_strips_us_broker_suffix(self) -> None:
        self.assertEqual(quote_lookup_symbol("TSM.US"), "TSM")
        self.assertEqual(quote_lookup_symbol("TSM"), "TSM")

    def test_build_quote_profile_payload_uses_known_name_when_yfinance_is_empty(self) -> None:
        with patch("app.services.logos._load_yfinance_ticker_info") as info_mock:
            info_mock.return_value = {}
            payload = build_quote_profile_payload("RAM")

        self.assertEqual(
            payload["company_name"],
            "Roundhill T-REX 2X Long DRAM Daily Target ETF",
        )
        self.assertEqual(payload["website"], "https://www.roundhillinvestments.com/etf/ram/")

    def test_build_quote_profile_payload_uses_dram_known_profile_when_yfinance_is_empty(self) -> None:
        with patch("app.services.logos._load_yfinance_ticker_info") as info_mock:
            info_mock.return_value = {}
            payload = build_quote_profile_payload("DRAM")

        self.assertEqual(payload["company_name"], "Roundhill Memory ETF")
        self.assertEqual(payload["website"], "https://www.roundhillinvestments.com/etf/dram/")

    def test_build_quote_profile_payload_uses_bare_symbol_for_us_broker_tickers(self) -> None:
        with patch("app.services.logos._load_yfinance_ticker_info") as info_mock:
            info_mock.return_value = {
                "longName": "Taiwan Semiconductor Manufacturing Company Limited",
                "website": "https://www.tsmc.com",
            }
            payload = build_quote_profile_payload("TSM.US")

        info_mock.assert_called_once_with("TSM")
        self.assertEqual(payload["ticker"], "TSM")
        self.assertEqual(
            payload["company_name"],
            "Taiwan Semiconductor Manufacturing Company Limited",
        )

    def test_fetch_quote_profile_keeps_pinned_roundhill_logo_during_forced_refresh(self) -> None:
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

                logo_path = logo_store_path_for("DRAM")
                original_logo = logo_path.read_bytes() if logo_path.exists() else None
                try:
                    profile = fetch_quote_profile("DRAM", force_refresh=True)
                finally:
                    if original_logo is None:
                        if logo_path.exists():
                            logo_path.unlink()
                    else:
                        logo_path.write_bytes(original_logo)

        self.assertEqual(profile.company_name, "Roundhill Memory ETF")
        self.assertEqual(profile.website, "https://www.roundhillinvestments.com")
        self.assertIn("/market-store/logos/DRAM.svg", profile.logo_url or "")
        fetch_logo_mock.assert_not_called()

    def test_forced_refresh_does_not_overwrite_roundhill_product_logos(self) -> None:
        with patch("app.services.logos.fetch_curated_logo_svg_bytes") as curated_mock, \
                patch("app.services.logos.fetch_remote_logo_bytes") as remote_mock:
            for ticker in ("DRAM", "RAM"):
                with self.subTest(ticker=ticker):
                    logo_path = logo_store_path_for(ticker)
                    original_logo = logo_path.read_bytes()

                    refresh_logo_store(
                        ticker,
                        f"https://www.roundhillinvestments.com/etf/{ticker.lower()}/",
                        force_refresh=True,
                    )

                    self.assertEqual(logo_path.read_bytes(), original_logo)

        curated_mock.assert_not_called()
        remote_mock.assert_not_called()

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

            summary = clear_non_historical_market_cache()

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
