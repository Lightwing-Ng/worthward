"""The investment-import compatibility boundary is explicit and executable.

Code version: v1.0.1
"""

from __future__ import annotations

import ast
import importlib
from pathlib import Path
from unittest.mock import patch

import pytest

from app.services import investment_import
from app.services.investment.importing import compat as compat


PROJECT_ROOT = Path(__file__).resolve().parents[3]
COMPAT_SOURCE = PROJECT_ROOT / "app/services/investment/importing/compat.py"
SEAM_CALLERS = (
    ("load_local_private_investment_evidence", "_load_local_private_investment_evidence"),
    ("extract_statement_pdf_text", "_extract_statement_pdf_text"),
    ("run_longbridge_cli_json", "run_longbridge_cli_json"),
    ("get_longbridge_cli_auth_status", "get_longbridge_cli_auth_status"),
    ("has_same_hsbc_cash_source_row", "_has_same_hsbc_cash_source_row"),
    (
        "build_investment_internal_transfer_binding_index",
        "build_investment_internal_transfer_binding_index",
    ),
)
SEAM_ARGUMENTS: dict[str, tuple[tuple, dict]] = {
    "load_local_private_investment_evidence": ((), {}),
    "extract_statement_pdf_text": ((b"pdf-bytes", "HSBC"), {}),
    "run_longbridge_cli_json": ((object(), ["account", "balance"]), {}),
    "get_longbridge_cli_auth_status": ((object(),), {}),
    "has_same_hsbc_cash_source_row": (({"a": 1}, {"a": 1}), {}),
    "build_investment_internal_transfer_binding_index": (([],), {}),
}


@pytest.mark.parametrize("seam_name", sorted(compat.PATCHABLE_SEAMS))
def test_every_declared_seam_resolves_to_its_owning_module(seam_name: str) -> None:
    owner_module = importlib.import_module(compat.PATCHABLE_SEAMS[seam_name])

    facade_target = getattr(investment_import, seam_name)

    assert facade_target is getattr(owner_module, seam_name), (
        f"{seam_name} is no longer a plain re-export of "
        f"{compat.PATCHABLE_SEAMS[seam_name]}"
    )


@pytest.mark.parametrize(("bridge_name", "seam_name"), SEAM_CALLERS)
def test_patching_the_facade_is_observed_through_the_bridge(
        bridge_name: str,
        seam_name: str,
) -> None:
    args, kwargs = SEAM_ARGUMENTS[bridge_name]
    sentinel = object()

    with patch.object(
        investment_import,
        seam_name,
        return_value=sentinel,
    ) as patched:
        assert getattr(compat, bridge_name)(*args, **kwargs) is sentinel

    assert patched.call_count == 1


def test_the_declaration_covers_exactly_the_bridged_functions() -> None:
    assert set(compat.PATCHABLE_SEAMS) == {seam for _, seam in SEAM_CALLERS}


def test_the_bridge_holds_no_business_logic_of_its_own() -> None:
    tree = ast.parse(COMPAT_SOURCE.read_text(encoding="utf-8"))
    bridge_functions = [
        node for node in tree.body if isinstance(node, ast.FunctionDef)
    ]

    assert {node.name for node in bridge_functions} == {
        name for name, _ in SEAM_CALLERS
    }
    for node in bridge_functions:
        # One deferred facade import plus one forwarding return, nothing else.
        assert len(node.body) == 2, node.name
        assert isinstance(node.body[0], ast.ImportFrom), node.name
        assert isinstance(node.body[1], ast.Return), node.name
        for inner in ast.walk(node):
            assert not isinstance(inner, (ast.If, ast.For, ast.While, ast.Try)), node.name


def test_domain_modules_reach_seams_only_through_the_declared_bridge() -> None:
    seam_names = set(compat.PATCHABLE_SEAMS)
    domain_root = PROJECT_ROOT / "app/services/investment/importing"
    domain_paths = sorted(domain_root.rglob("*.py"))
    assert domain_paths, "The investment-import domain inventory must not be empty."
    assert (domain_root / "brokers/hsbc/statements.py") in domain_paths
    assert (domain_root / "merge/identity.py") in domain_paths
    for path in domain_paths:
        if path == COMPAT_SOURCE:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module == (
                "app.services.investment_import"
            ):
                imported = {alias.name for alias in node.names}
                assert not (imported & seam_names), (
                    f"{path.name} binds a patch seam at import time"
                )
