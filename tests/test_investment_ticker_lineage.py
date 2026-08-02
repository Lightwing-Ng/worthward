"""
Tests for investment ticker lineage (legacy symbol -> successor chain).

Code version: v0.10.0
"""

from __future__ import annotations

import unittest

from app.infrastructure.storage import (
    expand_tickers_with_store_lineage,
    investment_ticker_identity_store_aliases,
    investment_ticker_lineage_legacy_tickers,
    investment_ticker_lineage_payload,
    investment_ticker_store_aliases,
    is_pinned_logo_ticker,
    is_ticker_fallback_company_name,
    known_ticker_company_names_payload,
    market_ticker_store_aliases,
    normalize_ticker,
    propagate_investment_lineage_identity_profiles,
    resolve_known_ticker_company_name,
)


class InvestmentTickerLineageTests(unittest.TestCase):
    def test_canonical_ticker_format_strips_us_and_preserves_market_suffixes(self) -> None:
        self.assertEqual(normalize_ticker("META.US"), "META")
        self.assertEqual(normalize_ticker("0700.HK"), "700.HK")
        self.assertEqual(normalize_ticker("600519.SH"), "600519.SH")
        self.assertEqual(normalize_ticker("000001.SZ"), "000001.SZ")
        self.assertEqual(normalize_ticker("660.KS"), "000660.KS")
        self.assertEqual(normalize_ticker("000660.KS"), "000660.KS")

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

    def test_hong_kong_money_market_fund_aliases_resolve_to_canonical_isins(self) -> None:
        expected_aliases = {
            "HK0000369196.USD": "HK0000369196",
            "HK0000584752.HK": "HK0000584752",
            "HK0001039582.USD": "HK0001039582",
            "LONGBRIDGE_HK_CASH_EQUIVALENT.PING_AN_MONEY_MARKET_USD.USD": "HK0000720752",
            "LONGBRIDGE_HK_CASH_EQUIVALENT.GAOTENG_MONEY_MARKET_USD.USD": "HK0000584737",
            "LONGBRIDGE_HK_CASH_EQUIVALENT.GAOTENG_MONEY_MARKET_HKD.HKD": "HK0000478872",
        }
        expected_names = {
            "005276756": "Franklin Templeton U.S. Dollar Short-Term Money Market Fund",
            "HK0000369196": "Taikang Kaitai Overseas Short Tenor Bond Fund A USD Acc",
            "HK0000584737": "GaoTeng WeValue USD Money Mkt A USD Acc",
            "HK0000478872": "GaoTeng WeInvest Money Market A HKD Acc",
            "HK0000720752": "Ping An Money Market P USD Acc",
            "HK0001039582": "CMS USD Money Market Fund B Acc",
        }

        for alias, isin in expected_aliases.items():
            with self.subTest(alias=alias):
                self.assertEqual(investment_ticker_store_aliases(alias)[0], isin)
                self.assertEqual(investment_ticker_lineage_payload()[alias], [isin])
        for isin, name in expected_names.items():
            with self.subTest(isin=isin):
                self.assertEqual(resolve_known_ticker_company_name(isin), name)

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

    def test_us_alias_symbol_names_remain_fallbacks_for_the_same_security(self) -> None:
        self.assertTrue(is_ticker_fallback_company_name("META.US", "META"))
        self.assertTrue(is_ticker_fallback_company_name("META", "META.US"))
        self.assertFalse(is_ticker_fallback_company_name("Meta Platforms, Inc.", "META"))

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

    def test_known_ticker_company_names_cover_both_alphabet_share_classes(self) -> None:
        self.assertEqual(resolve_known_ticker_company_name("GOOG"), "Alphabet Inc.")
        self.assertEqual(resolve_known_ticker_company_name("GOOGL"), "Alphabet Inc.")
        self.assertEqual(
            known_ticker_company_names_payload()["GOOGL.US"],
            "Alphabet Inc.",
        )

    def test_known_ticker_company_names_cover_yfinance_placeholder_profiles(self) -> None:
        expected_names = {
            "AAPL": "Apple Inc.",
            "BOXX": "Alpha Architect 1-3 Month Box ETF",
            "EUV": "Corgi Lithography & Semiconductor Photonics ETF",
            "IBKR": "Interactive Brokers Group, Inc.",
            "JEPQ": "JPMorgan Nasdaq Equity Premium Income ETF",
            "META": "Meta Platforms, Inc.",
            "MU": "Micron Technology, Inc.",
            "NVDA": "NVIDIA Corporation",
            "QQQ": "Invesco QQQ Trust, Series 1",
            "QCOM": "QUALCOMM Incorporated",
            "TQQQ": "ProShares UltraPro QQQ",
            "TSM": "Taiwan Semiconductor Manufacturing Company Limited",
        }
        payload = known_ticker_company_names_payload()

        for ticker, expected_name in expected_names.items():
            with self.subTest(ticker=ticker):
                self.assertEqual(resolve_known_ticker_company_name(ticker), expected_name)
                self.assertEqual(payload[f"{ticker}.US"], expected_name)

    def test_core_holdings_always_have_full_company_name_us_aliases(self) -> None:
        expected_names = {
            "HIBS": "Direxion Daily S&P 500 High Beta Bear 3X Shares ETF",
            "DIS": "The Walt Disney Company",
            "KO": "The Coca-Cola Company",
            "V": "Visa Inc.",
            "AXP": "American Express Company",
            "CVX": "Chevron Corporation",
            "C": "Citigroup Inc.",
            "BAC": "Bank of America Corporation",
            "JPM": "JPMorgan Chase & Co.",
            "AMZN": "Amazon.com, Inc.",
            "GS": "The Goldman Sachs Group, Inc.",
            "VZ": "Verizon Communications Inc.",
            "WFC": "Wells Fargo & Company",
            "SQQQ": "ProShares UltraPro Short QQQ",
            "EQNR": "Equinor ASA",
        }
        payload = known_ticker_company_names_payload()

        for ticker, name in expected_names.items():
            with self.subTest(ticker=ticker):
                self.assertEqual(resolve_known_ticker_company_name(ticker), name)
                self.assertEqual(resolve_known_ticker_company_name(f"{ticker}.US"), name)
                self.assertEqual(payload[ticker], name)
                self.assertEqual(payload[f"{ticker}.US"], name)

    def test_hkbn_uses_its_listed_company_name_and_pinned_logo(self) -> None:
        self.assertEqual(resolve_known_ticker_company_name("1310.HK"), "HKBN Ltd.")
        self.assertTrue(is_pinned_logo_ticker("1310.HK"))

    def test_known_ticker_company_names_cover_sgov(self) -> None:
        expected_name = "iShares 0-3 Month Treasury Bond ETF"

        self.assertEqual(resolve_known_ticker_company_name("SGOV"), expected_name)
        self.assertEqual(known_ticker_company_names_payload()["SGOV.US"], expected_name)

    def test_known_ticker_company_names_cover_qqqi(self) -> None:
        expected_name = "NEOS Nasdaq-100(R) High Income ETF"

        self.assertEqual(resolve_known_ticker_company_name("QQQI"), expected_name)
        self.assertEqual(known_ticker_company_names_payload()["QQQI.US"], expected_name)

    def test_known_ticker_company_names_cover_xqqi(self) -> None:
        expected_name = "NEOS Boosted Nasdaq-100(R) High Income ETF"

        self.assertEqual(resolve_known_ticker_company_name("XQQI"), expected_name)
        self.assertEqual(known_ticker_company_names_payload()["XQQI.US"], expected_name)


if __name__ == "__main__":
    unittest.main()
