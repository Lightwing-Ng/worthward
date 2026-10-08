"""Removable Beta blueprint; no market or strategy lifecycle hooks. Code version: v0.3.0."""

from __future__ import annotations

import os

from flask import Blueprint, Flask, abort, jsonify, render_template, request, url_for

from app.core.settings import get_settings

from .registry import EXPERIMENT_BY_ID, EXPERIMENTS, GUIDES

CODE_VERSION = "v0.3.0"


def build_page_context(experiment: dict[str, object]) -> dict[str, object]:
    """Read public presentation configuration without constructing the web runtime."""
    settings = get_settings()
    ui = settings["ui"]
    labels = ui["labels"]
    theme = ui["theme"]
    state = {
        "currentView": "beta",
        "defaults": settings["defaults"],
        "labels": labels,
        "theme": theme["light"],
        "themeLight": theme["light"],
        "themeDark": theme["dark"],
        "chartConfig": ui["chart"],
        "endpoints": {},
        "constraints": {"minTickers": 1, "maxTickers": 1},
        "base": {"currency": "USD", "timezone": "America/New_York"},
        "chart": {"series": [], "profiles": [], "tradingDate": None},
        "language": {"code": "en", "htmlLang": "en-US", "labels": {"en": "English"}, "options": ["en"], "translations": []},
        "dateDisplay": {"full": "d LLL yyyy", "short": "d LLL yyyy"},
        "beta": {"version": CODE_VERSION, "experiment": experiment["id"], "analyzeUrl": url_for("beta.analyze")},
    }
    context = {
        "current_view": "beta",
        "page_title": f"{experiment['title']} · Beta",
        "sidebar_title": "Beta",
        "language_html_lang": "en-US",
        "translate_ui": lambda value: value,
        "labels": labels,
        "theme": theme["light"],
        "theme_light": theme["light"],
        "theme_dark": theme["dark"],
        "logos": ui["logos"],
        "defaults": settings["defaults"],
        "version": settings["app"]["version"],
        "dock_urls": {"backtest": "/workspaces/backtest", "trade": "/trade/investment", "settings": "/settings/about"},
        "beta_version": CODE_VERSION,
        "beta_experiments": EXPERIMENTS,
        "beta_experiment": experiment,
        "beta_guide": GUIDES.get(experiment["id"]),
        "beta_next": EXPERIMENT_BY_ID.get(GUIDES.get(experiment["id"], {}).get("next")),
        "beta_state": state,
    }
    if experiment["id"] == "buy-analysis":
        from .buy_analysis import model_options
        context["beta_price_field_models"] = model_options()
        context["beta_committee_url"] = url_for("beta.buy_analysis")
    return context


def register_beta(app: Flask) -> bool:
    """Attach Beta once unless explicitly disabled for this application process."""
    enabled = os.environ.get("WORTHWARD_BETA_ENABLED", "1").strip().lower() in {"1", "true", "yes", "on"}

    @app.context_processor
    def inject_beta_navigation() -> dict[str, object]:
        return {"beta_enabled": enabled, "beta_url": url_for("beta.page") if enabled else None}

    if not enabled:
        return False
    from .analysis import BetaDataError, analyze as analyze_local

    blueprint = Blueprint("beta", __name__, url_prefix="/beta")

    @blueprint.get("")
    @blueprint.get("/<experiment>")
    def page(experiment: str = "regime-radar") -> str:
        selected = EXPERIMENT_BY_ID.get(experiment)
        if selected is None:
            abort(404)
        return render_template("beta.html", **build_page_context(selected))

    @blueprint.get("/api/analyze")
    def analyze():
        if set(request.args) - {"experiment", "ticker"} or any(len(request.args.getlist(key)) != 1 for key in request.args):
            return jsonify(error="Only one experiment and one ticker query value are supported."), 400
        try:
            payload = analyze_local(request.args.get("experiment", ""), request.args.get("ticker", ""))
        except BetaDataError as exc:
            return jsonify(error=str(exc)), exc.status
        return jsonify(payload)

    @blueprint.get("/api/buy-analysis")
    def buy_analysis():
        permitted = {"ticker", "model", "horizon", "threshold"}
        if set(request.args) - permitted or any(len(request.args.getlist(key)) != 1 for key in request.args):
            return jsonify(error="Only one ticker, model, horizon, and threshold query value are supported."), 400
        from .buy_analysis import DEFAULT_MODEL, analyze as analyze_committee
        try:
            horizon_text = request.args.get("horizon", "1")
            if len(horizon_text) > 2 or not horizon_text.isascii() or not horizon_text.isdecimal():
                raise BetaDataError("The forecast horizon must be an integer from 1 through 20.", 400)
            try:
                threshold = float(request.args.get("threshold", "60"))
            except (ValueError, OverflowError) as exc:
                raise BetaDataError("Enter a finite approval probability greater than 50% and at most 100%.", 400) from exc
            payload = analyze_committee(request.args.get("ticker", ""),
                                        model=request.args.get("model", DEFAULT_MODEL),
                                        horizon=int(horizon_text), threshold_pct=threshold)
        except BetaDataError as exc:
            return jsonify(error=str(exc)), exc.status
        return jsonify(payload)

    @blueprint.after_request
    def prevent_beta_response_caching(response):
        response.headers["Cache-Control"] = "no-store"
        return response

    app.register_blueprint(blueprint)
    return True
