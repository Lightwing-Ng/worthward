"""
Investment money-market icon selection contracts.

Code version: v0.4.2
"""

from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


def test_hkd_money_market_funds_use_the_abstract_token_and_all_usd_funds_keep_the_dollar_token() -> None:
    investment_js = (REPOSITORY_ROOT / "app/web/static/assets/js/investment.js").read_text()
    investment_css = (REPOSITORY_ROOT / "app/web/static/assets/css/views/investment.css").read_text()
    abstract_icon = REPOSITORY_ROOT / "market_store/logos/money-market-fund.ring.svg"

    assert "function isMoneyMarketFundTicker(ticker)" in investment_js
    assert "function getMoneyMarketFundTokenLogoClass(ticker)" in investment_js
    assert "function isFranklinMoneyMarketTicker(ticker)" in investment_js
    assert "&& !isFranklinMoneyMarketTicker(ticker)" not in investment_js
    assert "if (isFranklinMoneyMarketTicker(normalizedTicker)) return 'Franklin MMF';" not in investment_js
    assert "getTickerQuoteCurrency(ticker) === 'USD'" in investment_js
    assert "investment-money-market-fund-token-logo" in investment_js
    assert "const moneyMarketFundTokenLogoClass = getMoneyMarketFundTokenLogoClass(activeTicker);" in investment_js
    assert "investment-stock-details-identity .investment-cash-equivalent-token-logo" in investment_css
    assert "investment-stock-details-identity .investment-money-market-fund-token-logo" in investment_css
    assert "portfolio-donut-logo.investment-cash-equivalent-token-logo" in investment_css
    assert "portfolio-donut-logo.investment-money-market-fund-token-logo" in investment_css
    assert "renderAsToken: Boolean(tokenLogoClass)" in investment_js
    assert "money-market-fund.ring.svg" in investment_css
    assert abstract_icon.is_file()
