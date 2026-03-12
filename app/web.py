"""
HTTP route registration.

Code version: v3.1.8
"""

from __future__ import annotations

from dataclasses import asdict

import pandas as pd
from flask import Flask, jsonify, render_template, request, send_from_directory

from .comparisons import build_series_payload, slice_dataset_for_period
from .config import CODE_VERSION, DEFAULT_INTERVAL, DEFAULT_PERIOD, DEFAULT_TICKERS, PERIOD_OFFSETS, SUPPORTED_PERIODS
from .date_constraints import build_date_constraint_payload
from .logos import fetch_quote_profile, has_valid_ticker_format, is_known_ticker, normalize_ticker_input, search_tickers
from .market_data import fetch_history
from .presentation import build_series_colors, format_interval_label, format_period_label, hex_to_rgba
from .settings import get_settings
from .storage import PRIMARY_LOGOS_STORE_DIR, SEARCH_LOGOS_STORE_DIR, record_ticker_usage

MAX_TICKERS = 5
MIN_TICKERS = 2


def register_routes(app: Flask) -> None:
    settings = get_settings()
    defaults = settings["defaults"]
    labels = settings["ui"]["labels"]
    theme = settings["ui"]["theme"]
    chart_config = settings["ui"]["chart"]
    logos = settings["ui"]["logos"]
    app_meta = settings["app"]

    def validate_ticker_or_raise(raw_ticker: str) -> str:
        normalized_ticker = normalize_ticker_input(raw_ticker)
        if not has_valid_ticker_format(normalized_ticker):
            raise ValueError(f"Invalid ticker format: {raw_ticker}.")
        if not is_known_ticker(normalized_ticker):
            raise ValueError(f"Unknown or unsupported ticker: {normalized_ticker}.")
        return normalized_ticker

    def parse_requested_tickers() -> list[str]:
        numbered = [request.args.get(f"ticker_{index}", "") for index in range(1, MAX_TICKERS + 1)]
        has_numbered = any(value.strip() for value in numbered) or any(
            f"ticker_{index}" in request.args for index in range(1, MAX_TICKERS + 1)
        )
        if has_numbered:
            raw_tickers = numbered
        elif "ticker_a" in request.args or "ticker_b" in request.args:
            raw_tickers = [request.args.get("ticker_a", ""), request.args.get("ticker_b", "")]
        else:
            return []
        compacted = [normalize_ticker_input(value) for value in raw_tickers if normalize_ticker_input(value)]
        return compacted[:MAX_TICKERS]

    def align_datasets_on_common_dates(datasets: list[pd.DataFrame]) -> list[pd.DataFrame]:
        merged = datasets[0][["Date", "Close"]].rename(columns={"Close": "Close_0"}).copy()
        for index, dataset in enumerate(datasets[1:], start=1):
            merged = pd.merge(
                merged,
                dataset[["Date", "Close"]].rename(columns={"Close": f"Close_{index}"}),
                on="Date",
                how="inner",
            ).sort_values("Date")
        if merged.empty:
            raise ValueError("The selected tickers do not share any common trading dates.")
        return [
            merged[["Date", f"Close_{index}"]].rename(columns={f"Close_{index}": "Close"}).copy()
            for index in range(len(datasets))
        ]

    def resolve_effective_period_for_many(requested_period: str, datasets: list[pd.DataFrame]) -> tuple[str, str | None]:
        if requested_period == "max":
            return "max", None
        common_start = max(dataset["Date"].min() for dataset in datasets)
        common_end = min(dataset["Date"].max() for dataset in datasets)
        requested_start = (common_end - PERIOD_OFFSETS[requested_period]).normalize()
        if requested_start >= common_start:
            return requested_period, None

        fallback_period = "max"
        for candidate in SUPPORTED_PERIODS:
            if candidate == "max":
                break
            candidate_start = (common_end - PERIOD_OFFSETS[candidate]).normalize()
            if candidate_start >= common_start:
                fallback_period = candidate

        available_days = (common_end - common_start).days
        if available_days <= 0:
            raise ValueError("The selected tickers do not have overlapping trading history.")

        notice = (
            f"Requested period {requested_period} exceeds the shared trading history. "
            f"Automatically switched to {fallback_period} based on the latest common start date "
            f"({common_start.strftime('%-d %b %Y')})."
        )
        return fallback_period, notice

    @app.get("/")
    def index():
        requested_tickers = parse_requested_tickers()
        range_mode = request.args.get("range_mode", defaults.get("range_mode", "period")).strip().lower()
        period = request.args.get("period", defaults.get("period", DEFAULT_PERIOD)).strip().lower()
        exact_start = request.args.get("exact_start", "").strip()
        exact_end = request.args.get("exact_end", "").strip()
        interval = DEFAULT_INTERVAL
        include_dividends = request.args.getlist("include_dividends")[-1] == "1" if request.args.getlist("include_dividends") else False

        error = None
        notice = None
        date_notice = None
        display_range = ""
        profiles = []
        series = []
        performance_items = []
        date_constraints = build_date_constraint_payload()
        ticker_slots = requested_tickers.copy() if requested_tickers else ["", ""]
        period_label = format_period_label(period)

        if period not in SUPPORTED_PERIODS:
            period = DEFAULT_PERIOD

        try:
            if not requested_tickers:
                raise ValueError("")
            if len(requested_tickers) < MIN_TICKERS:
                raise ValueError("Please enter at least two ticker symbols.")
            validated_tickers = [validate_ticker_or_raise(ticker) for ticker in requested_tickers]
            if len(set(validated_tickers)) != len(validated_tickers):
                raise ValueError("Ticker symbols must be unique.")

            datasets = [fetch_history(ticker, interval, include_dividends) for ticker in validated_tickers]
            profiles = [fetch_quote_profile(ticker, False) for ticker in validated_tickers]
            date_constraints = build_date_constraint_payload(
                *datasets,
                requested_start=exact_start or None,
                requested_end=exact_end or None,
            )

            if range_mode == "exact":
                if not date_constraints.trading_dates:
                    raise ValueError("The selected tickers do not share any common trading dates.")
                aligned_start = pd.to_datetime(date_constraints.adjusted_start)
                aligned_end = pd.to_datetime(date_constraints.adjusted_end)
                aligned_datasets = align_datasets_on_common_dates(datasets)
                aligned_datasets = [
                    dataset[(dataset["Date"] >= aligned_start) & (dataset["Date"] <= aligned_end)].copy()
                    for dataset in aligned_datasets
                ]
                if any(dataset.empty for dataset in aligned_datasets):
                    raise ValueError("The selected exact range does not contain shared trading dates.")
                date_notice = date_constraints.message
                period_label = "Exact range"
            else:
                period, notice = resolve_effective_period_for_many(period, datasets)
                common_end_date = min(dataset["Date"].max() for dataset in datasets)
                sliced_datasets = [slice_dataset_for_period(dataset, period, common_end_date) for dataset in datasets]
                aligned_datasets = align_datasets_on_common_dates(sliced_datasets)
                period_label = format_period_label(period)

            colors = build_series_colors(len(validated_tickers), theme["accent_primary"], theme["accent_secondary"])
            series = [
                build_series_payload(ticker, dataset, color=color)
                for ticker, dataset, color in zip(validated_tickers, aligned_datasets, colors, strict=True)
            ]
            best_return = max(item.normalized_returns[-1] for item in series)
            common_start = aligned_datasets[0]["Date"].min()
            common_end = aligned_datasets[0]["Date"].max()
            display_range = f"{common_start.strftime('%-d %b %Y')} - {common_end.strftime('%-d %b %Y')}"
            performance_items = [
                {
                    "ticker": item.ticker,
                    "company_name": profile.company_name,
                    "logo_url": profile.logo_url,
                    "ending_return": item.normalized_returns[-1],
                    "color": item.color,
                    "shadow_color": hex_to_rgba(item.color or theme["accent_primary"], 0.22),
                    "is_winner": item.normalized_returns[-1] == best_return,
                }
                for item, profile in zip(series, profiles, strict=True)
            ]
            ticker_slots = validated_tickers.copy()
            record_ticker_usage(validated_tickers)
        except Exception as exc:  # noqa: BLE001
            error = str(exc) or None

        while len(ticker_slots) < MIN_TICKERS:
            ticker_slots.append("")

        return render_template(
            "index.html",
            error=error,
            notice=notice,
            date_notice=date_notice,
            interval=interval,
            period=period,
            interval_label=format_interval_label(interval),
            period_label=period_label,
            display_range=display_range,
            periods=SUPPORTED_PERIODS,
            period_labels={item: format_period_label(item) for item in SUPPORTED_PERIODS},
            series=series,
            profiles_json=[asdict(profile) for profile in profiles],
            performance_items=performance_items,
            ticker_slots=ticker_slots,
            max_tickers=MAX_TICKERS,
            min_tickers=MIN_TICKERS,
            include_dividends=include_dividends,
            range_mode=range_mode,
            exact_start=date_constraints.adjusted_start or exact_start,
            exact_end=date_constraints.adjusted_end or exact_end,
            version=app_meta.get("version", CODE_VERSION),
            updated_on=app_meta.get("updated_on", ""),
            labels=labels,
            theme=theme,
            chart_config=chart_config,
            logos=logos,
            defaults=defaults,
            endpoints={
                "symbolSearch": "/api/symbol-search",
                "dateConstraints": "/api/date-constraints",
            },
        )

    @app.get("/market-store/logos/<path:filename>")
    def market_store_logo(filename: str):
        for directory in (PRIMARY_LOGOS_STORE_DIR, SEARCH_LOGOS_STORE_DIR):
            candidate = directory / filename
            if candidate.exists():
                return send_from_directory(directory, filename)
        return ("Not Found", 404)

    @app.get("/api/symbol-search")
    def symbol_search():
        query = normalize_ticker_input(request.args.get("q", ""))
        limit = min(max(request.args.get("limit", default=5, type=int) or 5, 1), 5)
        if not query:
            return jsonify(search_tickers("", limit=limit))
        return jsonify([] if not has_valid_ticker_format(query) else search_tickers(query, limit=limit))

    @app.get("/api/date-constraints")
    def date_constraints_api():
        requested_tickers = parse_requested_tickers()
        if len(requested_tickers) < MIN_TICKERS:
            return jsonify(asdict(build_date_constraint_payload()))
        validated_tickers = [validate_ticker_or_raise(ticker) for ticker in requested_tickers]
        if len(set(validated_tickers)) != len(validated_tickers):
            return jsonify(asdict(build_date_constraint_payload()))
        include_dividends = request.args.get("include_dividends", "0") == "1"
        requested_start = request.args.get("exact_start", "").strip() or None
        requested_end = request.args.get("exact_end", "").strip() or None
        datasets = [fetch_history(ticker, DEFAULT_INTERVAL, include_dividends) for ticker in validated_tickers]
        payload = build_date_constraint_payload(*datasets, requested_start=requested_start, requested_end=requested_end)
        return jsonify(asdict(payload))
