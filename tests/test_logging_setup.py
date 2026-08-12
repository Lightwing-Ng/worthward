"""Tests for structured application console logging.

Code version: v0.2.0
"""

from __future__ import annotations

import logging

from app.core import logging_setup
from app.core.logging_setup import ConsoleFormatter, configure_logging


def test_console_formatter_uses_the_shared_spaced_schema() -> None:
    record = logging.LogRecord(
        name="werkzeug",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="Press CTRL+C to quit",
        args=(),
        exc_info=None,
    )

    formatted = ConsoleFormatter().format(record)

    assert formatted.endswith(" | INFO | werkzeug | job_id=- | Press CTRL+C to quit")


def test_configure_logging_installs_one_structured_console_handler() -> None:
    root_logger = logging.getLogger()
    original_handlers = root_logger.handlers[:]
    original_level = root_logger.level
    original_configured = logging_setup._CONFIGURED

    try:
        root_logger.handlers.clear()
        root_logger.setLevel(logging.WARNING)
        logging_setup._CONFIGURED = False
        configure_logging()

        assert root_logger.level == logging.INFO
        assert len(root_logger.handlers) == 1
        assert isinstance(root_logger.handlers[0].formatter, ConsoleFormatter)
        assert root_logger.handlers[0].level == logging.INFO
    finally:
        root_logger.handlers.clear()
        root_logger.handlers.extend(original_handlers)
        root_logger.setLevel(original_level)
        logging_setup._CONFIGURED = original_configured
