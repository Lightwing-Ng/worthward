"""Tests for read-only web market-history helpers.

Code version: v0.1.0
"""

from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import pandas as pd

from app.core.config import BASE_DIR
from app.services.range_options import build_supported_periods_from_dates
from app.web.market_history import (
    align_datasets_on_common_dates,
    build_supported_periods_for_history_store,
    extract_shared_dates,
    extract_union_dates,
)
from tests.factories.market import close_frame_for_dates, market_frame


class WebMarketHistoryTests(unittest.TestCase):
    def test_date_helpers_preserve_shared_and_union_date_contracts(self) -> None:
        first = close_frame_for_dates(
            ["2026-07-01", "2026-07-02", "2026-07-03"],
            [100.0, 101.0, 102.0],
        )
        second = close_frame_for_dates(
            ["2026-07-02", "2026-07-03", "2026-07-06"],
            [200.0, 201.0, 202.0],
        )

        aligned_first, aligned_second = align_datasets_on_common_dates([first, second])

        self.assertEqual(aligned_first["Date"].tolist(), list(pd.to_datetime(["2026-07-02", "2026-07-03"])))
        self.assertEqual(aligned_first["Close"].tolist(), [101.0, 102.0])
        self.assertEqual(aligned_second["Close"].tolist(), [200.0, 201.0])
        self.assertEqual(extract_shared_dates([first, second]).tolist(), aligned_first["Date"].tolist())
        self.assertEqual(
            extract_union_dates([first, second]).tolist(),
            list(pd.to_datetime(["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-06"])),
        )

    def test_supported_periods_read_an_alias_cache_without_accessing_production_storage(self) -> None:
        dataset = market_frame("QQQ")
        expected = build_supported_periods_from_dates(dataset["Date"], interval="1d")

        with TemporaryDirectory() as tempdir:
            path = Path(tempdir) / "historical" / "QQQ.parquet"
            for production_root in (BASE_DIR / "market_store", BASE_DIR / "settings_store"):
                self.assertFalse(path.resolve().is_relative_to(production_root.resolve()))
            path.parent.mkdir(parents=True)
            dataset.to_parquet(path, index=False)

            with (
                patch("app.web.market_history.market_ticker_store_aliases", return_value=("QQQ",)),
                patch("app.web.market_history.history_store_path_for", return_value=path),
            ):
                periods = build_supported_periods_for_history_store("QQQ.US")

            self.assertEqual(periods, expected)
            pd.testing.assert_frame_equal(pd.read_parquet(path), dataset)

    def test_supported_periods_fall_back_when_the_isolated_cache_is_unreadable(self) -> None:
        with TemporaryDirectory() as tempdir:
            path = Path(tempdir) / "historical" / "QQQ.parquet"
            path.parent.mkdir(parents=True)
            path.write_bytes(b"unreadable parquet cache")
            before_bytes = path.read_bytes()

            with (
                patch("app.web.market_history.market_ticker_store_aliases", return_value=("QQQ",)),
                patch("app.web.market_history.history_store_path_for", return_value=path),
            ):
                periods = build_supported_periods_for_history_store("QQQ")

            self.assertEqual(periods, ["max"])
            self.assertEqual(path.read_bytes(), before_bytes)


if __name__ == "__main__":
    unittest.main()
