"""Read-only Backtest research adapter for every registered strategy. Code version: v1.0.0."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
import hashlib
import math

import numpy as np
import pandas as pd

from app.services.dca import simulate_recurring_investment
from app.services.market_data import (
    history_store_path_for_interval,
    select_price_series,
)
from app.web.market_history import market_trading_dates_for_history
from strategies.backtest import combine_backtest_datasets, run_single_ticker_backtest
from strategies.interval_bridge import (
    DAILY_CLOSE_TO_NEXT_SESSION_OPEN,
    bridge_daily_signals_to_intraday,
)
from strategies.loader import instantiate_strategy
from strategies.tuning import search_space


@dataclass(frozen=True)
class ResearchRequest:
    strategy_id: str
    tickers: tuple[str, ...]
    start: str
    end: str
    interval: str = "1d"
    initial_capital: float = 10000
    execution_mode: str = "next_open"
    include_cash_dividends: bool = True
    reinvest_cash_dividends: bool = False
    stop_loss_enabled: bool = True
    params: dict = field(default_factory=dict)


def load_research_history(ticker: str, interval: str) -> pd.DataFrame:
    """Read existing prices without refresh, migration, synthetic bars, or store writes."""
    path = history_store_path_for_interval(ticker, interval)
    if not path.is_file():
        raise ValueError(
            f"No local {interval} history for {ticker}; refresh it in Settings first."
        )
    frame = pd.read_parquet(path)
    if "Synthetic" in frame and frame["Synthetic"].fillna(False).any():
        raise ValueError(f"Synthetic prices are not eligible for tuning: {ticker}.")
    required = {"Date", "Open", "High", "Low", "Close"}
    if not required.issubset(frame):
        raise ValueError(f"Incomplete OHLC history for {ticker}.")
    frame = select_price_series(frame, False, dividend_mode="price")
    frame.attrs["research_source"] = str(path)
    return frame


class ResearchSession:
    """Freeze market inputs, reuse production execution, and isolate the final holdout."""

    def __init__(
        self,
        request: ResearchRequest,
        *,
        bounds: dict | None = None,
        history_loader=load_research_history,
    ):
        self.request = request
        self.strategy = instantiate_strategy(request.strategy_id)
        if len(request.tickers) != self.strategy.get_required_ticker_count() or len(
            set(request.tickers)
        ) != len(request.tickers):
            raise ValueError(
                "Supply the strategy's complete ordered, distinct ticker list."
            )
        if not math.isfinite(request.initial_capital) or request.initial_capital <= 0:
            raise ValueError("Initial capital must be positive and finite.")
        if request.execution_mode not in {"next_open", "signal_close"}:
            raise ValueError("Invalid execution mode.")
        start, end = pd.Timestamp(request.start), pd.Timestamp(request.end)
        if pd.isna(start) or pd.isna(end) or start > end:
            raise ValueError("Invalid research dates.")
        self.model_interval = self.strategy.get_model_interval(request.interval)
        dimensions = search_space(self.strategy, bounds, request.params)
        preparation = self.strategy.normalize_params(request.params)
        for dimension in dimensions:
            # Reserve enough real warmup history and fetch each searchable factor once.
            if dimension.kind == "boolean":
                preparation[dimension.key] = True
            elif not dimension.options:
                preparation[dimension.key] = dimension.high
        datasets = self.strategy.load_market_datasets(
            request.tickers,
            interval=self.model_interval,
            start=start,
            end=end,
            params=preparation,
        )
        if datasets is None:
            if self.strategy.strategy_market_data_source != "default":
                raise ValueError(
                    "The declared strategy data provider returned no data."
                )
            datasets = [
                history_loader(ticker, self.model_interval)
                for ticker in request.tickers
            ]
        if len(datasets) != len(request.tickers):
            raise ValueError("The data provider returned an incomplete ticker set.")
        if self.strategy.strategy_market_data_source != "default" and any(
            frame.attrs.get("market_data_source")
            != self.strategy.strategy_market_data_source
            for frame in datasets
        ):
            raise ValueError(
                "The strategy data source does not match its declared provider."
            )
        self.model_frame = self._combine(datasets)
        self.execution_frame = (
            self.model_frame
            if self.model_interval == request.interval
            else self._combine(
                [history_loader(ticker, request.interval) for ticker in request.tickers]
            )
        )
        dates = market_trading_dates_for_history(
            self.execution_frame, request.tickers[0]
        )
        self.execution_frame = self.execution_frame.loc[
            dates.between(start.normalize(), end.normalize())
        ].reset_index(drop=True)
        dates = market_trading_dates_for_history(
            self.execution_frame, request.tickers[0]
        )
        self.dates = sorted(dates.unique())
        if len(self.dates) < 40:
            raise ValueError("Research requires at least 40 distinct trading dates.")
        split1, split2, split3 = [
            int(len(self.dates) * fraction) for fraction in (0.5, 0.65, 0.8)
        ]
        self.validation_windows = [
            (self.dates[split1], self.dates[split2 - 1]),
            (self.dates[split2], self.dates[split3 - 1]),
        ]
        self.holdout_window = (self.dates[split3], self.dates[-1])
        self.data_fingerprint = hashlib.sha256(
            pd.util.hash_pandas_object(self.model_frame, index=False).values.tobytes()
            + pd.util.hash_pandas_object(
                self.execution_frame, index=False
            ).values.tobytes()
        ).hexdigest()
        self.provenance = [
            {
                "source": frame.attrs.get(
                    "research_source", frame.attrs.get("market_data_source")
                ),
                "rows": len(frame),
            }
            for frame in datasets
        ]

    @staticmethod
    def _combine(datasets):
        for frame in datasets:
            if frame.empty or not {"Date", "Open", "High", "Low", "Close"}.issubset(
                frame
            ):
                raise ValueError("Research requires real, complete OHLC data.")
            if (
                frame["Date"].duplicated().any()
                or pd.to_datetime(frame["Date"], errors="coerce").isna().any()
            ):
                raise ValueError("Research timestamps must be valid and unique.")
            if not np.isfinite(
                frame[["Open", "High", "Low", "Close"]].to_numpy(dtype=float)
            ).all():
                raise ValueError(
                    "Non-finite market prices are not eligible for tuning."
                )
            if "Synthetic" in frame and frame["Synthetic"].fillna(False).any():
                raise ValueError("Synthetic prices are not eligible for tuning.")
        return (
            combine_backtest_datasets(datasets)
            if len(datasets) > 1
            else datasets[0].sort_values("Date").reset_index(drop=True).copy()
        )

    def evaluate_window(self, params: dict, window: tuple) -> dict:
        request = self.request
        first, last = window
        execution_dates = market_trading_dates_for_history(
            self.execution_frame, request.tickers[0]
        )
        prefix = self.execution_frame.loc[execution_dates <= last].copy()
        dates = market_trading_dates_for_history(prefix, request.tickers[0])
        model_evidence = {}
        if request.strategy_id == "dca":
            values = self.strategy.normalize_params(params)
            result = simulate_recurring_investment(
                request.tickers[0],
                prefix.loc[dates >= first],
                amount_per_period=values["amount"],
                frequency=values["frequency"],
                weekday=values["weekday"],
                month_day=values["month_day"],
                reinvest_cash_dividends=request.reinvest_cash_dividends,
                include_cash_dividends=request.include_cash_dividends,
                stop_loss_enabled=request.stop_loss_enabled,
            )
        else:
            if self.model_interval != request.interval:
                if (
                    self.strategy.get_signal_bridge(request.interval)
                    != DAILY_CLOSE_TO_NEXT_SESSION_OPEN
                ):
                    raise ValueError(
                        "No supported causal execution bridge is declared."
                    )
                model_dates = market_trading_dates_for_history(
                    self.model_frame, request.tickers[0]
                )
                model = self.model_frame.loc[model_dates.between(self.dates[0], last)]
                signals = self.strategy.compute_signals(model.copy(), params)
                signals = bridge_daily_signals_to_intraday(signals, prefix, dates)
            else:
                signals = self.strategy.compute_signals(prefix, params)
            if signals.presentation:
                predictions = signals.presentation.get("predictive_mean")
                if isinstance(predictions, list) and not any(
                    value is not None and math.isfinite(value) for value in predictions
                ):
                    raise ValueError(
                        "The model produced no finite causal predictions; this candidate cannot be ranked."
                    )
                model_evidence = {
                    key: signals.presentation[key]
                    for key in ("fingerprint", "source", "factors", "device")
                    if key in signals.presentation
                }
            scored_dates = market_trading_dates_for_history(
                signals.frame, request.tickers[0]
            )
            signals = replace(
                signals,
                frame=signals.frame.loc[scored_dates >= first].copy(),
                presentation={},
            )
            signals.metadata = {**signals.metadata, "tickers": list(request.tickers)}
            result = run_single_ticker_backtest(
                signals,
                request.initial_capital,
                execution_mode=request.execution_mode,
                interval=request.interval,
                reinvest_cash_dividends=request.reinvest_cash_dividends,
                include_cash_dividends=request.include_cash_dividends,
                stop_loss_enabled=request.stop_loss_enabled,
            )
        equity = np.asarray(result["chart"]["equity"], dtype=float)
        if not len(equity) or not np.isfinite(equity).all() or np.min(equity) <= 0:
            raise ValueError("No finite positive equity path was produced.")
        drawdown = float(np.max(1 - equity / np.maximum.accumulate(equity)) * 100)
        net_return = float(result["summary"]["net_return_pct"])
        return {
            "from": str(pd.Timestamp(first).date()),
            "to": str(pd.Timestamp(last).date()),
            "net_return_pct": net_return,
            "max_drawdown_pct": round(drawdown, 6),
            "score": net_return - 0.5 * drawdown,
            "model_evidence": model_evidence,
        }

    def validate(self, params: dict) -> dict:
        folds = [
            self.evaluate_window(params, window) for window in self.validation_windows
        ]
        return {
            "score": float(np.mean([fold["score"] for fold in folds])),
            "validation": folds,
        }

    def holdout(self, params: dict) -> dict:
        return self.evaluate_window(params, self.holdout_window)
