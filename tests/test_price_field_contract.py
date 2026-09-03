"""Shared Price Field contract tests. Code version: v1.0.0."""

from __future__ import annotations

from pathlib import Path
import unittest

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
        with self.assertRaisesRegex(ValueError, "Unsupported probability-grid schema"):
            build_probability_grid_presentation(
                schema="other/v1",
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
        self.assertIn("BACKTEST_PROBABILITY_GRID_VERSION: \"v0.26.0\"", source)


if __name__ == "__main__":
    unittest.main()
