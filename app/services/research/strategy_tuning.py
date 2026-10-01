"""Read-only Backtest research adapter for every registered strategy. Code version: v1.5.0."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
import hashlib
import math

import numpy as np
import pandas as pd

from app.services.analysis.dca import simulate_recurring_investment
from app.services.analysis.comparisons import market_trading_dates_for_history
from app.services.market.market_data import (
    history_store_path_for_interval,
    select_price_series,
)
from strategies.backtest import (
    combine_backtest_datasets,
    complete_distribution_skill,
    run_single_ticker_backtest,
)
from strategies.interval_bridge import (
    DAILY_CLOSE_TO_NEXT_SESSION_OPEN,
    bridge_daily_signals_to_intraday,
)
from strategies.loader import instantiate_strategy
from strategies.tuning import search_space

RESEARCH_OBJECTIVES = frozenset({"risk_adjusted_return", "net_return_pct", "crps_skill"})
DISTRIBUTION_RENDERER = "probability-grid-v1"
# Horizon 20 needs at least one complete in-window pair, so 21 sessions.
MIN_DISTRIBUTION_WINDOW_SESSIONS = 21
# Selection windows share the session's frozen, warmup-inclusive inputs, which
# are identical for every candidate and clipped at each window's end; only the
# full window reloads the provider exactly as an exact-range Backtest does.
SESSION_HISTORY_BASIS = "session-bundle-clipped-at-fold-end"
BACKTEST_HISTORY_BASIS = "exact-range-backtest-load"
_MODEL_EVIDENCE_KEYS = ("fingerprint", "source", "factors", "device")


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
    objective: str = "risk_adjusted_return"


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
        self._history_loader = history_loader
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
        if request.objective not in RESEARCH_OBJECTIVES:
            raise ValueError("Invalid research objective.")
        start, end = pd.Timestamp(request.start), pd.Timestamp(request.end)
        if pd.isna(start) or pd.isna(end) or start > end:
            raise ValueError("Invalid research dates.")
        self.model_interval = self.strategy.get_model_interval(request.interval)
        if request.objective == "crps_skill":
            # Reject before provider access: only a daily probability grid has
            # the Backtest 20-horizon CRPS skill headline.
            if (
                getattr(self.strategy, "strategy_presentation_renderer", "")
                != DISTRIBUTION_RENDERER
            ):
                raise ValueError(
                    "The CRPS skill objective requires a Price Field strategy "
                    "with a probability-grid presentation."
                )
            if request.interval != "1d" or self.model_interval != "1d":
                raise ValueError(
                    "The CRPS skill objective requires daily model and execution intervals."
                )
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
        if request.objective == "crps_skill":
            sessions = [split2 - split1, split3 - split2, len(self.dates) - split3]
            if min(sessions) < MIN_DISTRIBUTION_WINDOW_SESSIONS:
                raise ValueError(
                    "The CRPS skill objective needs at least "
                    f"{MIN_DISTRIBUTION_WINDOW_SESSIONS} trading sessions in every "
                    f"scored window; this range yields {sessions[0]}, {sessions[1]}, "
                    f"and {sessions[2]}. Request about 140 or more trading dates."
                )
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

    @staticmethod
    def _model_evidence(presentation: dict) -> dict:
        return {
            key: presentation[key] for key in _MODEL_EVIDENCE_KEYS if key in presentation
        }

    @staticmethod
    def _equity_metrics(result: dict) -> tuple[float, float]:
        equity = np.asarray(result["chart"]["equity"], dtype=float)
        if not len(equity) or not np.isfinite(equity).all() or np.min(equity) <= 0:
            raise ValueError("No finite positive equity path was produced.")
        drawdown = float(np.max(1 - equity / np.maximum.accumulate(equity)) * 100)
        return float(result["summary"]["net_return_pct"]), drawdown

    def _evaluate_distribution_window(
        self, params: dict, window: tuple
    ) -> tuple[dict, dict]:
        """Score one window on this session's frozen inputs, clipped at its end.

        Returns the window metrics and the Backtest summary that produced them.
        The bundle keeps the session's warmup-inclusive history, so a selection
        window is comparable across candidates but is not an exact-range
        Backtest of the same dates; see ``evaluate_full_window``.
        """
        request = self.request
        first, last = window
        model_dates = market_trading_dates_for_history(
            self.model_frame, request.tickers[0]
        )
        # Like the Backtest exact-range path, the model sees only the scored
        # rows; prior history comes from its warmup bundle, clipped at the fold.
        visible = self.model_frame.loc[model_dates.between(first, last)].copy()
        original_bundle = getattr(self.strategy, "_warmup_bundle", None)
        try:
            if original_bundle is not None:
                from strategies.price_field.pipeline import plain_market_bundle
                from strategies.price_field.pipeline import clip_price_field_bundle

                self.strategy._warmup_bundle = clip_price_field_bundle(
                    plain_market_bundle(original_bundle), pd.Timestamp(last)
                )
            signals = self.strategy.compute_signals(visible, params)
        finally:
            if original_bundle is not None:
                self.strategy._warmup_bundle = original_bundle
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
        presentation = result.get("strategy_presentation") or {}
        skill = complete_distribution_skill(presentation.get("diagnostics"))
        if skill is None:
            raise ValueError(
                "The model produced no complete 20-horizon CRPS skill evidence in "
                "the scored window; this candidate cannot be ranked."
            )
        net_return, drawdown = self._equity_metrics(result)
        summary = result["summary"]
        metrics = {
            "from": str(pd.Timestamp(first).date()),
            "to": str(pd.Timestamp(last).date()),
            "net_return_pct": net_return,
            "max_drawdown_pct": round(drawdown, 6),
            "score": 100.0 * skill,
            "crps_skill_pct": 100.0 * skill,
            "history_basis": SESSION_HISTORY_BASIS,
            "coverage_pct": summary.get("probability_field_forecast_coverage_pct"),
            "valid_pairs": summary.get("probability_field_valid_pairs"),
            "eligible_pairs": summary.get("probability_field_eligible_pairs"),
            "horizon_profile": summary.get("probability_field_horizon_profile"),
            "interval_80_coverage_pct": summary.get(
                "probability_field_interval_80_coverage_pct"
            ),
            "model_evidence": self._model_evidence(presentation),
        }
        return metrics, summary

    def evaluate_full_window(self, params: dict) -> dict:
        """Reproduce the exact-range Backtest CRPS headline for params.

        A search loads the session's inputs at every dimension's upper bound,
        and the start of that history changes start-dependent forecasts. This
        window therefore reloads the provider with ``params`` for the requested
        range, exactly as the Backtest loads it, in a separate session so the
        search session's strategy state is never replaced.
        """
        if self.request.objective != "crps_skill":
            raise ValueError(
                "Only the CRPS skill objective reports a full-window Backtest headline."
            )
        backtest = ResearchSession(
            replace(self.request, params=dict(params)),
            bounds={},
            history_loader=self._history_loader,
        )
        if backtest.dates != self.dates:
            raise ValueError(
                "The exact-range reload returned different trading dates than the "
                "research session; the full-window headline is not comparable."
            )
        metrics, summary = backtest._evaluate_distribution_window(
            params, (backtest.dates[0], backtest.dates[-1])
        )
        return {
            **metrics,
            "history_basis": BACKTEST_HISTORY_BASIS,
            "backtest_headline_pct": summary.get(
                "probability_field_distribution_skill_pct"
            ),
            "data_fingerprint": backtest.data_fingerprint,
            "sources": backtest.provenance,
        }

    def evaluate_window(self, params: dict, window: tuple) -> dict:
        request = self.request
        if request.objective == "crps_skill":
            return self._evaluate_distribution_window(params, window)[0]
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
            # Keep real pre-range warmup, but never expose observations after this fold.
            model_dates = market_trading_dates_for_history(
                self.model_frame, request.tickers[0]
            )
            model_window = model_dates <= last
            if request.strategy_id == "buy-and-hold":
                # This baseline enters once at portfolio initialization and has no warmup.
                model_window &= model_dates >= first
            model = self.model_frame.loc[model_window].copy()
            model.attrs["research_decision_start"] = pd.Timestamp(first)
            signals = self.strategy.compute_signals(model, params)
            signal_dates = market_trading_dates_for_history(
                signals.frame, request.tickers[0]
            )
            if signals.presentation:
                predictions = signals.presentation.get("predictive_mean")
                if predictions is not None:
                    if not isinstance(predictions, list) or len(predictions) != len(
                        signals.frame
                    ):
                        raise ValueError(
                            "Model predictions must align with signal dates."
                        )
                    eligible = np.isfinite(np.asarray(predictions, dtype=float))
                    if not (
                        eligible & signal_dates.between(first, last).to_numpy()
                    ).any():
                        raise ValueError(
                            "The model produced no finite causal predictions in the scored window; "
                            "this candidate cannot be ranked."
                        )
                model_evidence = self._model_evidence(signals.presentation)
                cycle = signals.presentation.get("price_action_cycle")
                if isinstance(cycle, dict) and {
                    "cycle_stage",
                    "cycle_state",
                }.issubset(signals.frame):
                    scored_cycle = signals.frame.loc[
                        signal_dates.between(first, last)
                    ]
                    stages = scored_cycle["cycle_stage"].fillna("").astype(str)
                    model_evidence["price_action_cycle"] = {
                        "stage_counts": {
                            stage: int((stages == stage).sum())
                            for stage in cycle.get("stage_counts", {})
                        },
                        "latest_state": str(scored_cycle["cycle_state"].iloc[-1]),
                        "buy_intents": int(scored_cycle["buy_signal"].sum()),
                        "sell_intents": int(scored_cycle["sell_signal"].sum()),
                    }
            if self.model_interval != request.interval:
                if (
                    self.strategy.get_signal_bridge(request.interval)
                    != DAILY_CLOSE_TO_NEXT_SESSION_OPEN
                ):
                    raise ValueError(
                        "No supported causal execution bridge is declared."
                    )
                # Warmup intents initialize the model, not positions in the execution window.
                signals = replace(
                    signals,
                    frame=signals.frame.loc[
                        signal_dates.between(self.dates[0], last)
                    ].copy(),
                    presentation={},
                )
                signals = bridge_daily_signals_to_intraday(signals, prefix, dates)
            scored_dates = market_trading_dates_for_history(
                signals.frame, request.tickers[0]
            )
            signals = replace(
                signals,
                frame=signals.frame.loc[scored_dates.between(first, last)].copy(),
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
        net_return, drawdown = self._equity_metrics(result)
        score = (
            net_return
            if request.objective == "net_return_pct"
            else net_return - 0.5 * drawdown
        )
        return {
            "from": str(pd.Timestamp(first).date()),
            "to": str(pd.Timestamp(last).date()),
            "net_return_pct": net_return,
            "max_drawdown_pct": round(drawdown, 6),
            "score": score,
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
