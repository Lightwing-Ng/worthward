"""Workspace history fallback helpers.

Code version: v0.1.1
"""

from __future__ import annotations


def load_history_after_fetch_failure(
    ctx: object,
    ticker: str,
    include_dividends_flag: bool,
    dividend_mode: str | None = None,
) -> object:
    """Use a readable local history file after a remote fetch failure."""
    path = ctx.history_store_path_for(ticker)
    if path.exists():
        try:
            return ctx.select_price_series(
                ctx.pd.read_parquet(path),
                include_dividends_flag,
                dividend_mode=dividend_mode,
            )
        except (ImportError, OSError, ValueError, KeyError, TypeError):
            pass
    raise ValueError(f"No market data returned for {ticker}.")
