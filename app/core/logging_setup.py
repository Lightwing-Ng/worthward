"""Structured console logging configuration for the application.

Code version: v0.2.0
"""

from __future__ import annotations

from contextvars import ContextVar
from datetime import UTC, datetime
import logging
from typing import Any


_CONFIGURED = False
_JOB_ID: ContextVar[str] = ContextVar("worthward_job_id", default="-")


class ConsoleFormatter(logging.Formatter):
    """Render concise console logs with stable, spaced fields."""

    def format(self, record: logging.LogRecord) -> str:
        timestamp = datetime.fromtimestamp(record.created, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        parts = [
            timestamp,
            record.levelname,
            record.name,
            f"job_id={getattr(record, 'job_id', _JOB_ID.get())}",
            record.getMessage(),
        ]
        if record.exc_info:
            parts.append(self.formatException(record.exc_info))
        return " | ".join(parts)


def configure_logging() -> None:
    """Configure the process-wide console logger once."""
    global _CONFIGURED
    if _CONFIGURED:
        return

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    root_logger.handlers.clear()

    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(ConsoleFormatter())
    root_logger.addHandler(console_handler)

    logging.captureWarnings(True)
    logging.getLogger("werkzeug").setLevel(logging.INFO)
    _CONFIGURED = True


def set_job_id(job_id: str) -> Any:
    """Bind a job identifier to logs emitted in the current context."""
    return _JOB_ID.set(job_id)


def reset_job_id(token: Any) -> None:
    """Restore the previous job identifier after a job completes."""
    _JOB_ID.reset(token)
