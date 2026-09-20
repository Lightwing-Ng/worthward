"""One maintained Backtest transaction-table column definition.

The server-rendered Backtest table and the optimistic workspace hydration
skeleton must present the same stable DOM structure: the same column order,
the same CSS width custom properties, and the same header labels. This module
owns that structure once and serializes it for the browser, so neither
renderer keeps a private copy.

It is a pure presentation definition. It holds no transaction values, reads no
store, and never fabricates a financial figure.

Code version: v1.0.0
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BacktestTransactionColumn:
    """One column of the Backtest transaction table."""

    key: str
    label: str
    width_token: str
    multi_asset_only: bool = False
    numeric: bool = False


BACKTEST_TRANSACTION_COLUMNS: tuple[BacktestTransactionColumn, ...] = (
    BacktestTransactionColumn("no", "No.", "--backtest-col-no-width"),
    BacktestTransactionColumn("date_time", "Date time", "--backtest-col-date-time-width"),
    BacktestTransactionColumn(
        "ticker", "Ticker", "--backtest-col-ticker-width", multi_asset_only=True
    ),
    BacktestTransactionColumn("side", "Side", "--backtest-col-side-width"),
    BacktestTransactionColumn("price", "Price", "--backtest-col-price-width", numeric=True),
    BacktestTransactionColumn(
        "quantity", "Quantity", "--backtest-col-quantity-width", numeric=True
    ),
    BacktestTransactionColumn(
        "realized_pnl", "Realized P&L", "--backtest-col-realized-pnl-width", numeric=True
    ),
    BacktestTransactionColumn(
        "unrealized_pnl",
        "Unrealized P&L",
        "--backtest-col-unrealized-pnl-width",
        numeric=True,
    ),
    BacktestTransactionColumn("cash", "Cash", "--backtest-col-cash-width", numeric=True),
    BacktestTransactionColumn(
        "market_value", "Market value", "--backtest-col-market-value-width", numeric=True
    ),
    BacktestTransactionColumn(
        "equity", "Equity", "--backtest-col-equity-width", numeric=True
    ),
)


def backtest_transaction_columns(*, multi_asset: bool = False) -> list[dict[str, object]]:
    """Return the ordered column definitions for one Backtest table variant."""
    return [
        {
            "key": column.key,
            "label": column.label,
            "widthToken": column.width_token,
            "numeric": column.numeric,
        }
        for column in BACKTEST_TRANSACTION_COLUMNS
        if multi_asset or not column.multi_asset_only
    ]
