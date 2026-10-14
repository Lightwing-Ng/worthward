"""HTTP boundary for the independent HSBC credit-card ledger.

Code version: v1.0.0
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path

from flask import jsonify, request
from werkzeug.exceptions import RequestEntityTooLarge

from app.core.config import SETTINGS_STORE_DIR
from app.services.credit_card_ledger import (
    commit_hsbc_credit_card_import,
    preview_hsbc_credit_card_import,
    read_credit_card_ledger,
)
from app.web.request_security import validate_local_browser_write_request


LOGGER = logging.getLogger(__name__)
CREDIT_CARD_STORE_PATH = SETTINGS_STORE_DIR / "credit_cards.json"
MAX_CREDIT_CARD_TEXT_BYTES = 1_048_576


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
