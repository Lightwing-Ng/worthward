#!/usr/bin/env python3
"""Tune any Backtest registry entry without writing production stores. Code version: v1.2.0."""
# ruff: noqa: E402

from __future__ import annotations

import argparse
from dataclasses import asdict
import json
import math
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import pandas as pd

from app.core.config import PERIOD_OFFSETS
from app.services.strategy_tuning import ResearchRequest, ResearchSession
from strategies.loader import (
    get_strategy_definition,
    instantiate_strategy,
    list_enabled_strategies,
)
from strategies.tuning import optimize, search_space


CODE_VERSION = "v1.2.0"


def strategy_contract(entry, *, include_parameters=False):
    """Describe the same registry and parameter definitions used by Backtest."""
    strategy = instantiate_strategy(entry["id"])
    contract = {
        **entry,
        "market_data_source": strategy.strategy_market_data_source,
        "execution_intervals": {
            interval: {
                "model_interval": strategy.get_model_interval(interval),
                "signal_bridge": strategy.get_signal_bridge(interval),
            }
            for interval in strategy.get_supported_intervals()
        },
        "search_space": [asdict(dimension) for dimension in search_space(strategy)],
    }
    if include_parameters:
        contract["parameters"] = [
            asdict(definition) for definition in strategy.get_parameter_definitions()
        ]
    return contract


def read_json_object(value, label):
    """Accept inline JSON or an explicitly selected UTF-8 JSON file."""
    source = (
        Path(value[1:]).expanduser().read_text(encoding="utf-8")
        if value.startswith("@")
        else value
    )
    parsed = json.loads(source)
    if not isinstance(parsed, dict):
        raise ValueError(f"{label} must be a JSON object.")
    return parsed


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Registry-driven Backtest tuning; production market stores are read-only."
    )
    parser.add_argument(
        "--version", action="version", version=f"strategy_tune {CODE_VERSION}"
    )
    discovery = parser.add_mutually_exclusive_group()
    discovery.add_argument(
        "--catalog",
        action="store_true",
        help="List every enabled strategy and its search contract.",
    )
    discovery.add_argument(
        "--describe",
        metavar="STRATEGY",
        help="Print one strategy's complete parameter and data contract without loading prices.",
    )
    parser.add_argument("--strategy")
    parser.add_argument(
        "--ticker",
        action="append",
        default=[],
        help="Repeat in the strategy's ordered ticker order.",
    )
    parser.add_argument("--period", choices=tuple(PERIOD_OFFSETS), default="1y")
    parser.add_argument("--from", dest="start")
    parser.add_argument("--to", dest="end")
    parser.add_argument("--interval", choices=("1d", "1m"), default="1d")
    parser.add_argument("--capital", type=float, default=10000)
    parser.add_argument(
        "--execution-mode", choices=("next_open", "signal_close"), default="next_open"
    )
    parser.add_argument("--price-only", action="store_true")
    parser.add_argument("--reinvest-dividends", action="store_true")
    parser.add_argument(
        "--no-stop-loss",
        action="store_true",
        help="Block loss-making algorithmic exits, matching the Backtest UI default; CLI allows them by default.",
    )
    parser.add_argument(
        "--method", choices=("genetic", "random-forest"), default="genetic"
    )
    parser.add_argument(
        "--objective",
        choices=("risk-adjusted-return", "net-return"),
        default="risk-adjusted-return",
        help="Rank validation folds by risk-adjusted return or net return percentage.",
    )
    parser.add_argument("--trials", type=int, default=16)
    parser.add_argument(
        "--time-budget",
        type=float,
        default=600,
        help="Stop scheduling evaluations after this many seconds; an in-flight evaluation finishes.",
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--params",
        default="{}",
        help="Fixed strategy parameters as JSON or @path/to/params.json.",
    )
    parser.add_argument(
        "--bounds",
        help="Search domains as JSON or @path/to/bounds.json; numeric [min,max] or choices. Use '{}' to evaluate one fixed configuration.",
    )
    parser.add_argument(
        "--output",
        help="New output directory, never an existing directory or production store.",
    )
    args = parser.parse_args(argv)
    if args.catalog:
        print(
            json.dumps(
                [strategy_contract(item) for item in list_enabled_strategies()],
                indent=2,
            )
        )
        return 0
    if args.describe:
        try:
            print(
                json.dumps(
                    strategy_contract(
                        get_strategy_definition(args.describe), include_parameters=True
                    ),
                    indent=2,
                )
            )
            return 0
        except (ValueError, TypeError, RuntimeError) as exc:
            print(f"strategy_tune failed: {exc}", file=sys.stderr)
            return 1
    if not args.strategy or not args.ticker or not args.output:
        parser.error("--strategy, --ticker, and a new --output directory are required.")
    if bool(args.start) != bool(args.end):
        parser.error("Supply both --from and --to for an exact window.")
    output = Path(args.output).expanduser().resolve()
    from app.core.config import MARKET_STORE_DIR, SETTINGS_STORE_DIR

    if any(
        output == root.resolve() or root.resolve() in output.parents
        for root in (MARKET_STORE_DIR, SETTINGS_STORE_DIR)
    ):
        parser.error(
            "Research output cannot be inside production market or settings stores."
        )
    try:
        if output.exists():
            raise ValueError("The output directory must be new.")
        if not 1 <= args.trials <= 1000:
            raise ValueError("Trials must be between 1 and 1,000.")
        if not math.isfinite(args.time_budget) or args.time_budget <= 0:
            raise ValueError("Time budget must be positive and finite.")
        if args.seed < 0:
            raise ValueError("Seed must be nonnegative.")
        fixed = read_json_object(args.params, "Parameters")
        bounds = (
            read_json_object(args.bounds, "Bounds") if args.bounds is not None else None
        )
        end = (
            pd.Timestamp(args.end)
            if args.end
            else pd.Timestamp.now(tz="UTC").tz_localize(None).normalize()
        )
        start = (
            pd.Timestamp(args.start)
            if args.start
            else end - PERIOD_OFFSETS[args.period]
        )
        request = ResearchRequest(
            strategy_id=args.strategy,
            tickers=tuple(ticker.strip().upper() for ticker in args.ticker),
            start=str(start.date()),
            end=str(end.date()),
            interval=args.interval,
            initial_capital=args.capital,
            execution_mode=args.execution_mode,
            include_cash_dividends=not args.price_only,
            reinvest_cash_dividends=args.reinvest_dividends and not args.price_only,
            stop_loss_enabled=not args.no_stop_loss,
            params=fixed,
            objective=(
                "net_return_pct"
                if args.objective == "net-return"
                else "risk_adjusted_return"
            ),
        )
        session = ResearchSession(request, bounds=bounds)
        output.mkdir(parents=True, exist_ok=False)

        def record(item):
            with (output / "evaluations.jsonl").open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(item, allow_nan=False) + "\n")
            print(
                f"Trial {item['trial']}: {item['status']}", file=sys.stderr, flush=True
            )

        result = optimize(
            session.strategy,
            session.validate,
            method=args.method,
            trials=args.trials,
            seed=args.seed,
            time_budget=args.time_budget,
            bounds=bounds,
            fixed=fixed,
            on_result=record,
        )
        result.update(
            {
                "schema": "backtest-tuning/v1",
                "cli_version": CODE_VERSION,
                "request": asdict(request),
                "period": args.period,
                "data_fingerprint": session.data_fingerprint,
                "sources": session.provenance,
                "objective": (
                    "mean validation net return pct"
                    if args.objective == "net-return"
                    else "mean validation return pct minus 0.5 times max drawdown pct"
                ),
                "holdout_used_for_selection": False,
            }
        )
        if result["best"]:
            try:
                result["holdout"] = session.holdout(result["best"]["params"])
            except (ValueError, RuntimeError, ArithmeticError) as exc:
                result["holdout"] = {"status": "failed_closed", "error": str(exc)}
                result["status"] = "failed_closed"
        with (output / "result.json").open("x", encoding="utf-8") as handle:
            json.dump(result, handle, indent=2, allow_nan=False)
        print(str(output / "result.json"))
        return 0 if result["status"] == "completed" else 1
    except (ValueError, TypeError, RuntimeError, OSError) as exc:
        print(f"strategy_tune failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
