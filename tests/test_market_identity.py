"""Tests for canonical ticker market identity reuse.

Code version: v1.1.1
"""

from __future__ import annotations

import pandas as pd
import pytest

from app.core.market_identity import infer_ticker_market, market_timezone_for_ticker
from app.infrastructure import broker_market_data
from app.services import comparisons, market_data
from app.web import market_history


def test_market_identity_covers_polish_tickers_without_cross_module_drift() -> None:
    assert infer_ticker_market("CDR.WA") == "EU"
    assert market_timezone_for_ticker("CDR.WA") == "Europe/Paris"
    assert comparisons._market_for_ticker is infer_ticker_market
    assert comparisons._market_timezone_for_ticker is market_timezone_for_ticker
    assert market_data.infer_ticker_market is infer_ticker_market
    assert market_data.market_timezone_for_ticker is market_timezone_for_ticker
    assert broker_market_data._infer_market_from_ticker is infer_ticker_market
    assert broker_market_data._market_timezone_for_ticker is market_timezone_for_ticker


@pytest.mark.parametrize(
    ("ticker", "market", "timezone"),
    (
        ("0700.HK", "HK", "Asia/Hong_Kong"),
        ("000660.KS", "KR", "Asia/Seoul"),
        ("7203.T", "JP", "Asia/Tokyo"),
        ("600519.SS", "CN", "Asia/Shanghai"),
        ("D05.SI", "SG", "Asia/Singapore"),
        ("HSBA.L", "UK", "Europe/London"),
        ("BHP.AX", "AU", "Australia/Sydney"),
        ("SHOP.TO", "CA", "America/Toronto"),
        ("CDR.WA", "EU", "Europe/Paris"),
        ("NOKIA.HE", "FI", "Europe/Helsinki"),
        ("RELIANCE.NS", "IN", "Asia/Kolkata"),
        ("2330.TW", "TW", "Asia/Taipei"),
        ("1155.KL", "MY", "Asia/Kuala_Lumpur"),
        ("PTT.BK", "TH", "Asia/Bangkok"),
        ("BBCA.JK", "ID", "Asia/Jakarta"),
        ("FPH.NZ", "NZ", "Pacific/Auckland"),
        ("PETR4.SA", "BR", "America/Sao_Paulo"),
        ("GGAL.BA", "AR", "America/Argentina/Buenos_Aires"),
        ("WALMEX.MX", "LATAM", "America/Mexico_City"),
        ("GARAN.IS", "TR", "Europe/Istanbul"),
        ("TEVA.TA", "IL", "Asia/Jerusalem"),
        ("2222.SR", "SA", "Asia/Riyadh"),
        ("NPN.JO", "ZA", "Africa/Johannesburg"),
        ("QNBK.QA", "QA", "Asia/Qatar"),
        ("AAPL", "US", "America/New_York"),
    ),
)
def test_every_supported_market_family_has_a_canonical_timezone(
        ticker: str,
        market: str,
        timezone: str,
) -> None:
    assert infer_ticker_market(ticker) == market
    assert market_timezone_for_ticker(ticker) == timezone


@pytest.mark.parametrize(
    ("ticker", "inside", "before", "after"),
    (
        ("GARAN.IS", "2026-09-14T07:00:00Z", "2026-09-14T06:59:00Z", "2026-09-14T15:00:00Z"),
        ("GGAL.BA", "2026-09-14T13:30:00Z", "2026-09-14T13:29:00Z", "2026-09-14T20:00:00Z"),
    ),
)
def test_distinct_market_sessions_use_their_local_exchange_hours(
        ticker: str,
        inside: str,
        before: str,
        after: str,
) -> None:
    assert comparisons._is_market_session_timestamp(pd.Timestamp(inside), ticker)
    assert not comparisons._is_market_session_timestamp(pd.Timestamp(before), ticker)
    assert not comparisons._is_market_session_timestamp(pd.Timestamp(after), ticker)
    assert broker_market_data._is_regular_market_session(pd.Timestamp(inside), ticker)
    assert not broker_market_data._is_regular_market_session(pd.Timestamp(before), ticker)
    assert not broker_market_data._is_regular_market_session(pd.Timestamp(after), ticker)


def test_web_history_reuses_the_service_trading_date_helper() -> None:
    assert (
        market_history.market_trading_dates_for_history
        is comparisons.market_trading_dates_for_history
    )
    frame = pd.DataFrame({"Date": [pd.Timestamp("2026-09-07 20:15:00")]})

    assert comparisons.market_trading_dates_for_history(frame, "AAPL").tolist() == [
        pd.Timestamp("2026-09-08")
    ]
