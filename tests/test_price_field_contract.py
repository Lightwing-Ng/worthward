"""Shared Price Field contract tests. Code version: v1.4.0."""

from __future__ import annotations

from pathlib import Path
import unittest

import numpy as np
import pandas as pd

from tests.factories.market import ohlc_frame_for_dates

import strategies.algorithms.strategy_bayesian_price_field as bayesian_module
import strategies.algorithms.strategy_lstm_price_field as lstm_module
import strategies.price_field_pipeline as pipeline_module
from strategies.price_field_contract import (
    BAYESIAN_PRICE_FIELD_SCHEMA,
    LSTM_PRICE_FIELD_SCHEMA,
    LSTM_PRICE_FIELD_STRATEGY_ID,
    PRICE_FIELD_SCHEMAS,
    PRICE_FIELD_STRATEGY_IDS,
    PROBABILITY_FIELD_COLUMNS,
    PROBABILITY_FIELD_GAP_PX,
    PROBABILITY_FIELD_ROWS_ABOVE,
    PROBABILITY_GRID_RENDERER,
    build_probability_grid_presentation,
    is_price_field_strategy,
    probability_grid_geometry_fields,
)


class PriceFieldContractTests(unittest.TestCase):
    def test_derived_factors_are_causal_and_preserve_missing_turnover(self) -> None:
        frame = ohlc_frame_for_dates("NVDA", pd.bdate_range("2025-01-01", periods=100).astype(str).tolist())
        frame["Volume"] = np.arange(100, 200, dtype=float)
        frame["Turnover"] = frame["Volume"] * frame["Close"]
        build = pipeline_module.build_price_field_factor_columns
        values = build(frame, 20, use_volume_at_price=False)
        prefix = build(frame.iloc[:75], 20, use_volume_at_price=False)
        for key, _, _ in pipeline_module._PRICE_VOLUME_FACTORS:
            np.testing.assert_allclose(values[key][:75], prefix[key], equal_nan=True)
        self.assertTrue(np.isnan(values["momentum_60d"][:60]).all())
        self.assertAlmostEqual(values["momentum_60d"][60], np.log(frame.Close[60] / frame.Close[0]))
        self.assertAlmostEqual(values["relative_volume_20d"][20], 120 / np.mean(np.arange(100, 120)))
        self.assertAlmostEqual(values["turnover"][0], np.log1p(frame.Turnover[0]))
        missing = build(frame.drop(columns="Turnover"), 20, use_volume_at_price=False)
        self.assertTrue(np.isnan(missing["turnover"]).all())
        self.assertTrue(np.isnan(missing["illiquidity_20d"]).all())
        frame.loc[30, "High"] = frame.loc[30, "Low"] = frame.loc[30, "Close"]
        frame.loc[40, "Turnover"] = -1
        invalid = build(frame, 20, use_volume_at_price=False)
        self.assertTrue(np.isnan(invalid["close_location"][30]))
        self.assertTrue(np.isnan(invalid["turnover"][40]))
        self.assertTrue(np.isnan(invalid["illiquidity_20d"][40:60]).all())

    def test_factor_subgroups_are_reusable_without_duplicating_controls(self) -> None:
        from app.web.strategy_forms import build_strategy_form_fields, build_strategy_form_sections
        for strategy in (bayesian_module.BayesianPriceFieldStrategy(), lstm_module.LSTMPriceFieldStrategy()):
            def factory(_key):
                return strategy
            fields = build_strategy_form_fields(strategy.strategy_id, {}, strategy_factory=factory)
            sections = build_strategy_form_sections(strategy.strategy_id, fields, strategy_factory=factory)
            factors = next(section for section in sections if section["key"] == "factors")
            flattened = [field for group in factors["subgroups"] for field in group["fields"]]
            self.assertCountEqual([field["key"] for field in flattened], list(pipeline_module.PRICE_FIELD_FACTOR_PARAMETER_KEYS))
            self.assertEqual(len(flattened), len({field["key"] for field in flattened}))
            self.assertIn("Price and volume", [group["title"] for group in factors["subgroups"]])

    def test_model_neutral_pipeline_is_the_runtime_owner(self) -> None:
        for name in (
            "_build_factor_columns",
            "_bundle_ohlcv_frame",
            "_estimate_return_state",
            "_executable_return_targets",
            "_merge_bundle_observations",
            "_normalize_ohlcv_frame",
            "_probabilistic_diagnostics",
            "_probability_threshold_signals",
            "build_price_field_factor_status",
        ):
            self.assertIs(
                getattr(bayesian_module, name),
                getattr(lstm_module, name),
            )
        self.assertIs(
            bayesian_module._build_factor_columns,
            pipeline_module.build_price_field_factor_columns,
        )
        self.assertIs(
            bayesian_module._BAYESIAN_FACTOR_DEFINITIONS,
            pipeline_module.PRICE_FIELD_FACTOR_DEFINITIONS,
        )
        self.assertIs(
            lstm_module.PRICE_FIELD_FACTOR_DEFINITIONS,
            pipeline_module.PRICE_FIELD_FACTOR_DEFINITIONS,
        )
        self.assertIs(
            lstm_module.load_price_field_market_bundle,
            pipeline_module.load_price_field_market_bundle,
        )

    def test_lstm_does_not_import_the_bayesian_strategy_module(self) -> None:
        source = (
            Path(__file__).resolve().parents[1]
            / "strategies/algorithms/strategy_lstm_price_field.py"
        ).read_text(encoding="utf-8")
        self.assertNotIn("strategy_bayesian_price_field", source)
        self.assertNotIn("BayesianPriceFieldStrategy(", source)

    def test_market_factor_provider_uses_a_model_neutral_canonical_module(self) -> None:
        root = Path(__file__).resolve().parents[1]
        pipeline_source = (
            root / "strategies/price_field_pipeline.py"
        ).read_text(encoding="utf-8")
        legacy_source = (
            root / "app/services/bayesian_market_factors.py"
        ).read_text(encoding="utf-8")

        self.assertIn("app.services.price_field_market_factors", pipeline_source)
        self.assertNotIn("app.services.bayesian_market_factors", pipeline_source)
        self.assertIn("price_field_market_factors", legacy_source)

    def test_strategy_ids_and_schemas_are_paired(self) -> None:
        self.assertEqual(
            PRICE_FIELD_STRATEGY_IDS,
            {"bayesian-price-field", "lstm-price-field"},
        )
        self.assertEqual(
            PRICE_FIELD_SCHEMAS,
            {BAYESIAN_PRICE_FIELD_SCHEMA, LSTM_PRICE_FIELD_SCHEMA},
        )
        self.assertTrue(is_price_field_strategy("bayesian-price-field"))
        self.assertTrue(is_price_field_strategy(LSTM_PRICE_FIELD_STRATEGY_ID))
        self.assertFalse(is_price_field_strategy("macd"))

    def test_geometry_is_the_accepted_twenty_by_twenty_lattice(self) -> None:
        geometry = probability_grid_geometry_fields()
        self.assertEqual(geometry["renderer"], PROBABILITY_GRID_RENDERER)
        self.assertEqual(geometry["columns"], 20)
        self.assertEqual(geometry["rows_above"], 10)
        self.assertEqual(geometry["rows_below"], 10)
        self.assertEqual(geometry["gap_px"], 2)
        self.assertEqual(geometry["padding_px"], 8)
        self.assertEqual(geometry["min_cell_px"], 4)
        self.assertEqual(PROBABILITY_FIELD_COLUMNS, 20)
        self.assertEqual(PROBABILITY_FIELD_ROWS_ABOVE, 10)
        self.assertEqual(PROBABILITY_FIELD_GAP_PX, 2)

    def test_builder_preserves_schema_and_rejects_unknown_schemas(self) -> None:
        payload = build_probability_grid_presentation(
            schema=LSTM_PRICE_FIELD_SCHEMA,
            model_version="lstm-price-field-model/v1.0.0",
            cell_display_threshold_pct=5.0,
            distribution_kind="lstm-gaussian-log-return",
            predictive_mean=[0.1],
            predictive_scale=[0.2],
            probability_up=[0.6],
            return_autoregression=[0.0],
            return_long_run_mean=[0.0],
            return_innovation_scale=[0.2],
            data_keys=["2026-01-02T00:00:00"],
            diagnostics={"causal": True},
            factors=[],
            factor_selection={"selected": []},
            device={"resolved": "cpu"},
            source={"market_data": "longbridge-cli"},
            fingerprint="abc",
        )
        self.assertEqual(payload["schema"], LSTM_PRICE_FIELD_SCHEMA)
        self.assertEqual(payload["renderer"], PROBABILITY_GRID_RENDERER)
        self.assertEqual(payload["columns"], 20)

        bayesian_payload = build_probability_grid_presentation(
            schema=BAYESIAN_PRICE_FIELD_SCHEMA,
            model_version="bayesian-price-field-model/v1.0.0",
            cell_display_threshold_pct=5.0,
            distribution_kind="dynamic-normal-log-return",
            predictive_mean=[0.1],
            predictive_scale=[0.2],
            probability_up=[0.6],
            return_autoregression=[0.0],
            return_long_run_mean=[0.0],
            return_innovation_scale=[0.2],
            data_keys=["2026-01-02T00:00:00"],
            diagnostics={"causal": True},
            factors=[],
            factor_selection={"selected": []},
            device={"resolved": "cpu"},
            source={"market_data": "longbridge-cli"},
            fingerprint="abc",
        )
        model_owned_keys = {"schema", "model_version", "distribution_kind"}
        shared_lstm = {
            key: value for key, value in payload.items() if key not in model_owned_keys
        }
        shared_bayesian = {
            key: value
            for key, value in bayesian_payload.items()
            if key not in model_owned_keys
        }
        self.assertEqual(shared_lstm, shared_bayesian)

        with self.assertRaisesRegex(ValueError, "Unsupported probability-grid schema"):
            build_probability_grid_presentation(
                schema="invalid-schema",
                model_version="x",
                cell_display_threshold_pct=5.0,
                distribution_kind="x",
                predictive_mean=[],
                predictive_scale=[],
                probability_up=[],
                return_autoregression=[],
                return_long_run_mean=[],
                return_innovation_scale=[],
                data_keys=[],
                diagnostics={},
                factors=[],
                factor_selection={},
                device={},
                source={},
                fingerprint="",
            )

    def test_javascript_allowlist_matches_the_python_contract(self) -> None:
        source = (
            Path(__file__).resolve().parents[1]
            / "app/web/static/assets/js/backtest/probability-grid.js"
        ).read_text(encoding="utf-8")
        for schema in PRICE_FIELD_SCHEMAS:
            self.assertIn(f'"{schema}"', source)
        for strategy_id in PRICE_FIELD_STRATEGY_IDS:
            self.assertIn(f'"{strategy_id}"', source)
        self.assertIn("probability-grid-v1", source)
        self.assertIn("BACKTEST_PROBABILITY_GRID_VERSION: \"v0.32.0\"", source)

    def test_native_disclosures_use_shared_trailing_chevron(self) -> None:
        root = Path(__file__).resolve().parents[1]
        css = (root / "app/web/static/assets/css/components/collapse.css").read_text()
        tokens = (root / "app/web/static/assets/css/foundation/tokens.css").read_text()
        self.assertIn("M1.41 1.59 6 6.17l4.59-4.58L12 3l-6 5-6-5z", tokens)
        self.assertNotIn("arrowtriangle.down.circle", tokens)
        self.assertIn("details > summary::after", css)
        self.assertIn("details[open] > summary::after", css)
        self.assertNotIn("summary::before", css)
        self.assertNotIn("triangle.fill.svg", css)


if __name__ == "__main__":
    unittest.main()
