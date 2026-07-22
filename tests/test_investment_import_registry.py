"""Tests for investment parser registration and persistence boundaries.

Code version: v1.0.0
"""

from __future__ import annotations

from copy import deepcopy
import unittest

from app.services.investment_import_registry import (
    InvestmentParserRegistry,
    commit_investment_import,
)


class InvestmentImportRegistryTests(unittest.TestCase):
    def test_registry_dispatches_by_canonical_broker_and_format(self) -> None:
        registry = InvestmentParserRegistry()
        registry.register(
            "Longbridge-HK",
            "paired-files",
            lambda *, records: {"transactions": records},
        )

        payload = registry.parse(
            "longbridge_hk",
            "paired_files",
            records=[{"id": "trade-1"}],
        )

        self.assertEqual(payload["transactions"], [{"id": "trade-1"}])

    def test_registry_rejects_duplicate_and_unknown_parsers(self) -> None:
        registry = InvestmentParserRegistry()
        registry.register("ibkr", "csv", lambda: {"transactions": []})
        with self.assertRaisesRegex(ValueError, "already registered"):
            registry.register("IBKR", "CSV", lambda: {"transactions": []})
        with self.assertRaisesRegex(ValueError, "Unsupported investment import parser"):
            registry.parse("hsbc", "paste")

    def test_registry_rejects_malformed_parser_payloads(self) -> None:
        registry = InvestmentParserRegistry()
        registry.register("ibkr", "csv", lambda: {"transactions": ["invented"]})

        with self.assertRaisesRegex(ValueError, "non-dictionary transaction"):
            registry.parse("ibkr", "csv")

    def test_commit_boundary_is_idempotent_and_verifies_readback(self) -> None:
        store: dict[str, object] = {"transactions": [{"id": "existing"}]}
        invalidations: list[bool] = []

        def normalize(payload):
            return deepcopy(payload)

        def merge(existing, incoming):
            rows = {
                row["id"]: deepcopy(row)
                for row in existing.get("transactions", []) + incoming.get("transactions", [])
            }
            return {"transactions": list(rows.values())}

        def update_store(updater):
            nonlocal store
            stored_payload, result = updater(deepcopy(store))
            store = stored_payload
            return result

        kwargs = {
            "normalize_payload": normalize,
            "merge_payloads": merge,
            "update_store": update_store,
            "load_store": lambda: deepcopy(store),
            "invalidate_cache": lambda: invalidations.append(True),
        }
        imported = {"transactions": [{"id": "incoming"}]}

        first = commit_investment_import(imported, **kwargs)
        second = commit_investment_import(imported, **kwargs)

        self.assertEqual(first, second)
        self.assertEqual([row["id"] for row in second["transactions"]], ["existing", "incoming"])
        self.assertEqual(invalidations, [True, True])

    def test_commit_boundary_detects_readback_divergence(self) -> None:
        def update_store(updater):
            _stored, result = updater({"transactions": []})
            return result

        with self.assertRaisesRegex(RuntimeError, "readback did not match"):
            commit_investment_import(
                {"transactions": [{"id": "expected"}]},
                normalize_payload=deepcopy,
                merge_payloads=lambda _existing, incoming: incoming,
                update_store=update_store,
                load_store=lambda: {"transactions": []},
                invalidate_cache=lambda: None,
            )


if __name__ == "__main__":
    unittest.main()
