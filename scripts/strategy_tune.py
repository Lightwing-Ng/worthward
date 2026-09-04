#!/usr/bin/env python3
"""Tune any Backtest registry entry without writing production stores. Code version: v1.0.0."""
# ruff: noqa: E402

from __future__ import annotations

import argparse
from dataclasses import asdict
import json
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import pandas as pd

from app.core.config import PERIOD_OFFSETS
from app.services.strategy_tuning import ResearchRequest, ResearchSession
from strategies.loader import instantiate_strategy, list_enabled_strategies
from strategies.tuning import optimize, search_space


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Registry-driven Backtest tuning; production market stores are read-only."
    )
    parser.add_argument(
        "--catalog",
        action="store_true",
        help="List every enabled strategy and its search contract.",
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
    parser.add_argument("--no-stop-loss", action="store_true")
    parser.add_argument(
        "--method", choices=("genetic", "random-forest"), default="genetic"
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
        "--params", default="{}", help="Fixed strategy parameters as JSON."
    )
    parser.add_argument(
        "--bounds",
        help="Search only these parameter domains, as JSON; numeric [min,max], or categorical choices.",
    )
    parser.add_argument(
        "--output",
        help="New output directory, never an existing directory or production store.",
    )
    args = parser.parse_args(argv)
    if args.catalog:
        print(
            json.dumps(
                [
                    {
                        **item,
                        "search_space": [
                            asdict(dimension)
                            for dimension in search_space(
                                instantiate_strategy(item["id"])
                            )
                        ],
                    }
                    for item in list_enabled_strategies()
                ],
                indent=2,
            )
        )
        return 0
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
        fixed = json.loads(args.params)
        bounds = json.loads(args.bounds) if args.bounds else None
        if not isinstance(fixed, dict) or (
            bounds is not None and not isinstance(bounds, dict)
        ):
            raise ValueError("Parameters and bounds must be JSON objects.")
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
            args.strategy,
            tuple(ticker.strip().upper() for ticker in args.ticker),
            str(start.date()),
            str(end.date()),
            args.interval,
            args.capital,
            args.execution_mode,
            not args.price_only,
            args.reinvest_dividends and not args.price_only,
            not args.no_stop_loss,
            fixed,
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
                "request": asdict(request),
                "period": args.period,
                "data_fingerprint": session.data_fingerprint,
                "sources": session.provenance,
                "objective": "mean validation return pct minus 0.5 times max drawdown pct",
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
