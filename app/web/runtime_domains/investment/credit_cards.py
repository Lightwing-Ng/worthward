"""HTTP boundary for the independent HSBC credit-card ledger.

Code version: v1.2.0
- Fixed: Card commits return with cached dated FX instead of awaiting a provider.
"""

from __future__ import annotations

from bisect import bisect_right
import hashlib
import logging
import math
from pathlib import Path

from flask import jsonify, request
from werkzeug.exceptions import RequestEntityTooLarge

from app.core.config import SETTINGS_STORE_DIR
from app.services.credit_card_ledger import (
    commit_hsbc_credit_card_import,
    preview_hsbc_credit_card_import,
    read_credit_card_ledger,
)
from app.services.market.market_cap import FX_RATE_SPECS, load_fx_history
from app.web.request_security import validate_local_browser_write_request


LOGGER = logging.getLogger(__name__)
CREDIT_CARD_STORE_PATH = SETTINGS_STORE_DIR / "credit_cards.json"
MAX_CREDIT_CARD_TEXT_BYTES = 1_048_576


def _cached_credit_card_fx_history(rows: list[dict]) -> dict:
    """Select existing authoritative closes at or before each reward date."""
    histories = {}
    for currency in sorted({row["currency"] for row in rows} & FX_RATE_SPECS.keys()):
        values = {}
        for row in load_fx_history(currency).itertuples(index=False):
            rate = float(row.UsdPerUnit)
            if math.isfinite(rate) and rate > 0:
                values[row.Date.date().isoformat()] = 1.0 / rate
        dates = sorted(values)
        selected = {}
        for row in rows:
            if row["currency"] != currency:
                continue
            index = bisect_right(dates, row["date"]) - 1
            if index >= 0:
                selected[dates[index]] = values[dates[index]]
        if selected:
            histories[currency] = {
                "dates": sorted(selected),
                "values": {day: selected[day] for day in sorted(selected)},
            }
    return histories


def read_credit_card_reward_payload(path: Path, build_fx_history) -> dict:
    """Read posted RewardCash and its dated FX without projecting card cash flows."""
    try:
        ledger = read_credit_card_ledger(path)
        rows = [
            {
                "id": row["id"],
                "date": row["transaction_date"],
                "currency": row["currency"],
                "amount": row["amount"],
            }
            for row in ledger["transactions"]
            if row["kind"] == "rewardcash" and row["status"] == "posted"
        ]
        return {
            "status": "complete",
            "transactions": rows,
            "fx_rate_history_by_currency": build_fx_history(rows) if rows else {},
            "warnings": [],
        }
    except (OSError, RuntimeError, ValueError):
        LOGGER.exception("The credit-card rewards could not be read safely")
        return {
            "status": "unavailable",
            "transactions": [],
            "fx_rate_history_by_currency": {},
            "warnings": ["Credit-card rewards are unavailable; check the card ledger."],
        }


def build_credit_card_context(context: dict[str, object]) -> dict[str, object]:
    """Build card-only handlers without using the investment commit pipeline."""
    ledger_path = Path(context.get("CREDIT_CARD_STORE_PATH", CREDIT_CARD_STORE_PATH))

    def respond(payload: dict, status: int = 200):
        response = jsonify(payload)
        response.status_code = status
        response.headers["Cache-Control"] = "no-store"
        return response

    def request_text() -> str:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict) or not isinstance(payload.get("text"), str):
            raise ValueError("Paste the full HSBC credit-card page as text.")
        text = payload["text"]
        if len(text.encode("utf-8")) > MAX_CREDIT_CARD_TEXT_BYTES:
            raise RequestEntityTooLarge
        expected_digest = payload.get("source_sha256")
        if (
            expected_digest is not None
            and expected_digest != hashlib.sha256(text.encode("utf-8")).hexdigest()
        ):
            raise ValueError(
                "The credit-card text changed. Preview it again before importing."
            )
        return text

    def run_import(*, commit: bool):
        rejection = validate_local_browser_write_request(
            request, action_label="Credit-card imports"
        )
        if rejection:
            return respond({"success": False, "error": rejection}, 403)
        try:
            text = request_text()
            action = (
                commit_hsbc_credit_card_import
                if commit
                else preview_hsbc_credit_card_import
            )
            result = action(text, ledger_path)
            if commit and not result.get("ready"):
                return respond(
                    {
                        "success": False,
                        **result,
                        "error": "Review the ambiguous credit-card records before importing.",
                    },
                    400,
                )
            if commit:
                result["credit_card_rewards"] = read_credit_card_reward_payload(
                    ledger_path,
                    _cached_credit_card_fx_history,
                )
            return respond({"success": True, **result, "committed": commit})
        except RequestEntityTooLarge:
            return respond(
                {
                    "success": False,
                    "error": "The credit-card text exceeds the 1 MiB limit.",
                },
                413,
            )
        except ValueError as exc:
            return respond({"success": False, "error": str(exc)}, 400)
        except (OSError, RuntimeError):
            LOGGER.exception("The credit-card ledger could not be processed safely")
            return respond(
                {
                    "success": False,
                    "error": "The credit-card ledger could not be processed safely. No investment records were changed.",
                },
                500,
            )

    def credit_card_preview():
        return run_import(commit=False)

    def credit_card_import():
        return run_import(commit=True)

    def credit_card_read():
        try:
            return respond({"success": True, **read_credit_card_ledger(ledger_path)})
        except (OSError, RuntimeError, ValueError):
            LOGGER.exception("The credit-card ledger could not be read safely")
            return respond(
                {
                    "success": False,
                    "error": "The credit-card ledger could not be read safely.",
                },
                500,
            )

    return {
        "credit_card_preview": credit_card_preview,
        "credit_card_import": credit_card_import,
        "credit_card_read": credit_card_read,
    }
