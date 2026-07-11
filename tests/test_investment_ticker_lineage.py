"""
Tests for investment ticker lineage (legacy symbol -> successor chain).

Code version: v0.2.0
"""

from __future__ import annotations

import unittest

from app.infrastructure.storage import (
    expand_tickers_with_store_lineage,
    investment_ticker_identity_store_aliases,
    investment_ticker_lineage_legacy_tickers,
    investment_ticker_lineage_payload,
    investment_ticker_store_aliases,
    known_ticker_company_names_payload,
    market_ticker_store_aliases,
    propagate_investment_lineage_identity_profiles,
    resolve_known_ticker_company_name,
)


class InvestmentTickerLineageTests(unittest.TestCase):
    def test_sk_hynix_transition_prefers_requested_symbol_then_compatible_alias(self) -> None:
        self.assertEqual(market_ticker_store_aliases("SKHYV"), ["SKHYV", "SKHY"])
        self.assertEqual(market_ticker_store_aliases("SKHY"), ["SKHY", "SKHYV"])

    def test_splg_lineage_prefers_spym_before_spy_proxy(self) -> None:
        aliases = investment_ticker_store_aliases("SPLG.US")

        # Canonical is bare for US; suffixed variants kept in aliases for compat.
        self.assertEqual(aliases[0], "SPYM")
        self.assertIn("SPYM.US", aliases)
        self.assertIn("SPLG.US", aliases)
        self.assertLess(aliases.index("SPYM"), aliases.index("SPY"))
        # SPLG may appear after SPY depending on insertion; main point is SPYM preferred and suffixed kept.

    def test_splg_identity_aliases_exclude_spy_proxy(self) -> None:
        aliases = investment_ticker_identity_store_aliases("SPLG.US")

        self.assertEqual(aliases[0], "SPYM")
        self.assertIn("SPYM.US", aliases)
        self.assertIn("SPLG.US", aliases)
        self.assertNotIn("SPY", aliases)
        self.assertNotIn("SPY.US", aliases)

    def test_splg_lineage_payload_is_api_serializable(self) -> None:
        payload = investment_ticker_lineage_payload()

        self.assertEqual(payload["SPLG.US"], ["SPYM", "SPYM.US", "SPLG", "SPY", "SPY.US"])
        self.assertEqual(payload["SPLG"], ["SPYM", "SPYM.US", "SPY", "SPY.US"])

    def test_expand_tickers_with_store_lineage_deduplicates_candidates(self) -> None:
        expanded = expand_tickers_with_store_lineage(["SPLG.US", "SPYM.US"])

        self.assertEqual(expanded[0], "SPYM")
        self.assertIn("SPYM.US", expanded)
        self.assertEqual(expanded.count("SPYM.US"), 1)

    def test_us_broker_aliases_include_bare_and_suffixed_symbols(self) -> None:
        suffixed_aliases = investment_ticker_store_aliases("TSM.US")
        bare_aliases = investment_ticker_store_aliases("TSM")

        self.assertEqual(suffixed_aliases[:2], ["TSM", "TSM.US"])
        self.assertEqual(bare_aliases[:2], ["TSM", "TSM.US"])

    def test_share_class_symbols_do_not_gain_us_suffix_alias(self) -> None:
        aliases = investment_ticker_store_aliases("BRK-B")

        self.assertEqual(aliases, ["BRK-B"])

    def test_spym_inherits_splg_identity_profile(self) -> None:
        ticker_profiles = {
            "SPLG.US": {
                "ticker": "SPLG.US",
                "company_name": "State Street SPDR Portfolio S&P 500 ETF",
                "logo_url": "/market-store/logos/SPYM.svg",
            },
        }
        propagate_investment_lineage_identity_profiles(ticker_profiles)

        self.assertEqual(
            ticker_profiles["SPYM"]["company_name"],
            "State Street SPDR Portfolio S&P 500 ETF",
        )
        self.assertEqual(investment_ticker_lineage_legacy_tickers("SPYM"), ["SPLG.US", "SPLG"])

    def test_known_ticker_company_names_keep_dram_and_ram_distinct(self) -> None:
        self.assertEqual(
            resolve_known_ticker_company_name("DRAM"),
            "Roundhill Memory ETF",
        )
        self.assertEqual(
            known_ticker_company_names_payload()["DRAM.US"],
            "Roundhill Memory ETF",
        )
        self.assertEqual(
            resolve_known_ticker_company_name("RAM"),
            "Roundhill T-REX 2X Long DRAM Daily Target ETF",
        )
        self.assertEqual(
            known_ticker_company_names_payload()["RAM.US"],
            "Roundhill T-REX 2X Long DRAM Daily Target ETF",
        )


if __name__ == "__main__":
    unittest.main()
