"""Tests for portable application startup.

Code version: v1.3.0
"""

from __future__ import annotations

import os
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import Mock, patch

from flask import render_template
from jinja2 import FileSystemLoader

from app import create_app


class AppStartupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.entrypoint = runpy.run_path("main.py", run_name="__mp_main__")

    def test_host_and_port_aliases_preserve_canonical_precedence(self) -> None:
        # The spawn import path deliberately skips Flask and network startup.
        options = runpy.run_path("main.py", run_name="__mp_main__")["_build_run_options"]
        config = {"app": {"debug": False}, "server": {}}
        with patch.dict("os.environ", {"ANTIGRAVITY_HOST": "127.0.0.2", "ANTIGRAVITY_PORT": "8765"}, clear=True):
            self.assertEqual(options(config)["host"], "127.0.0.2")
            self.assertEqual(options(config)["port"], 8765)
            with patch.dict("os.environ", {"WORTHWARD_HOST": "127.0.0.3", "WORTHWARD_PORT": "8766"}):
                self.assertEqual(options(config)["host"], "127.0.0.3")
                self.assertEqual(options(config)["port"], 8766)

    def test_debug_controls_reloading_and_watches_the_configuration(self) -> None:
        build_options = self.entrypoint["_build_run_options"]
        with patch.dict(os.environ, {}, clear=True):
            for debug_enabled in (False, True):
                with self.subTest(debug=debug_enabled):
                    options = build_options(
                        {"app": {"debug": debug_enabled}, "server": {}}
                    )

                    self.assertIs(options["debug"], debug_enabled)
                    self.assertIs(options["use_reloader"], debug_enabled)
                    self.assertIs(options["use_debugger"], False)
                    self.assertEqual(
                        options["extra_files"],
                        [str(self.entrypoint["CONFIG_PATH"])] if debug_enabled else [],
                    )

    def test_debug_environment_override_accepts_explicit_boolean_values(self) -> None:
        build_options = self.entrypoint["_build_run_options"]
        for expected, values in (
            (True, ("1", "true", "yes", "on")),
            (False, ("0", "false", "no", "off")),
        ):
            for value in values:
                with self.subTest(value=value), patch.dict(
                    os.environ, {"WORTHWARD_DEBUG": value}, clear=True
                ):
                    options = build_options(
                        {"app": {"debug": not expected}, "server": {}}
                    )

                    self.assertIs(options["debug"], expected)
                    self.assertIs(options["use_reloader"], expected)

    def test_debug_environment_alias_preserves_canonical_precedence(self) -> None:
        build_options = self.entrypoint["_build_run_options"]
        config = {"app": {"debug": False}, "server": {}}
        with patch.dict(os.environ, {"ANTIGRAVITY_DEBUG": "true"}, clear=True):
            self.assertIs(build_options(config)["debug"], True)
            with patch.dict(os.environ, {"WORTHWARD_DEBUG": "false"}):
                self.assertIs(build_options(config)["debug"], False)

    def test_invalid_debug_override_fails_before_server_startup(self) -> None:
        build_options = self.entrypoint["_build_run_options"]
        with patch.dict(os.environ, {"WORTHWARD_DEBUG": "maybe"}, clear=True):
            with self.assertRaises(ValueError):
                build_options({"app": {"debug": False}, "server": {}})

    def test_broker_prewarm_runs_only_in_the_serving_process(self) -> None:
        prewarm = self.entrypoint["_prewarm_broker_context"]
        for use_reloader, child_environment, expected_calls in (
            (False, {}, 1),
            (True, {}, 0),
            (True, {"WERKZEUG_RUN_MAIN": "true"}, 1),
        ):
            with self.subTest(reloader=use_reloader, child=child_environment):
                broker_prewarm = Mock(return_value=(True, "Ready"))
                with patch.dict(os.environ, child_environment, clear=True), patch.dict(
                    prewarm.__globals__,
                    {"prewarm_longbridge_quote_context": broker_prewarm},
                ):
                    prewarm(use_reloader)

                self.assertEqual(broker_prewarm.call_count, expected_calls)

    def test_runtime_distinguishes_cli_reloading_from_wsgi_import(self) -> None:
        initialize = self.entrypoint["_initialize_runtime"]
        for module_name, debug_enabled, expected_reloader in (
            ("__main__", True, True),
            ("__main__", False, False),
            ("main", True, False),
        ):
            with self.subTest(module=module_name, debug=debug_enabled):
                config = {"app": {"debug": debug_enabled}, "server": {}}
                prewarm = Mock()
                application = object()
                with patch.dict(os.environ, {}, clear=True), patch.dict(
                    initialize.__globals__,
                    {
                        "__name__": module_name,
                        "configure_logging": Mock(),
                        "get_settings": Mock(return_value=config),
                        "bootstrap_runtime_network_for_yfinance": Mock(),
                        "_prewarm_broker_context": prewarm,
                    },
                ), patch("app.create_app", return_value=application):
                    actual_application, actual_settings = initialize()

                self.assertIs(actual_application, application)
                self.assertIs(actual_settings, config)
                prewarm.assert_called_once_with(expected_reloader)

    def test_spawned_workers_do_not_initialize_the_application(self) -> None:
        with patch("app.create_app") as factory, patch(
            "app.infrastructure.broker_market_data.prewarm_longbridge_quote_context"
        ) as prewarm, patch(
            "app.infrastructure.runtime_network.bootstrap_runtime_network_for_yfinance"
        ) as bootstrap:
            entrypoint = runpy.run_path("main.py", run_name="__mp_main__")

        self.assertIsNone(entrypoint["app"])
        self.assertEqual(entrypoint["settings"], {})
        factory.assert_not_called()
        prewarm.assert_not_called()
        bootstrap.assert_not_called()

    def test_debug_reloads_a_changed_template_without_recreating_the_app(self) -> None:
        application = create_app()
        application.debug = True
        with tempfile.TemporaryDirectory() as directory:
            template = Path(directory) / "reload-probe.html"
            template.write_text("Before", encoding="utf-8")
            application.jinja_loader = FileSystemLoader(directory)
            with application.test_request_context("/beta"):
                self.assertEqual(render_template(template.name), "Before")
                previous_mtime = template.stat().st_mtime
                template.write_text("After", encoding="utf-8")
                os.utime(template, (previous_mtime + 2, previous_mtime + 2))

                self.assertEqual(render_template(template.name), "After")

    def test_app_factory_does_not_require_device_local_investment_evidence(self) -> None:
        with patch(
            "app.infrastructure.storage.verify_persisted_investment_source_artifacts",
            side_effect=RuntimeError("Device-local evidence is unavailable."),
        ) as verifier:
            application = create_app()

        self.assertEqual(application.name, "app")
        verifier.assert_not_called()


if __name__ == "__main__":
    unittest.main()
