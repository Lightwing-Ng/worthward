"""The investment-import compatibility boundary is explicit and executable.

Code version: v1.0.2
"""

from __future__ import annotations

import ast
import importlib
import os
from pathlib import Path
import subprocess
import sys
from textwrap import dedent
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


@pytest.mark.parametrize("first_module", [
    "app.services.investment.importing.merge.currency_balances",
    "app.services.investment.importing.merge.identity",
    "app.services.investment_import",
], ids=["currency-helper-first", "identity-first", "facade-first"])
def test_currency_normalizers_preserve_cold_import_and_facade_contracts(
    first_module, tmp_path,
):
    probe = dedent("""
        import importlib
        from pathlib import Path
        import sys

        assert not any(name.startswith('app.services.investment') for name in sys.modules)
        first = importlib.import_module(sys.argv[1])
        assert Path(first.__file__).resolve().is_relative_to(Path.cwd().resolve())
        # Call before explicitly importing the other entrypoints so lazy broker
        # dependencies must also initialize correctly from the helper-first path.
        assert first._normalize_currency_balance_map({'USD': '0.00'}) == {'USD': '0'}
        helper = importlib.import_module('app.services.investment.importing.merge.currency_balances')
        identity = importlib.import_module('app.services.investment.importing.merge.identity')
        facade = importlib.import_module('app.services.investment_import')
        names = (
            '_normalize_hsbc_currency_code', '_normalize_currency_balance_map',
            '_normalize_hsbc_currency_balance_map', '_normalize_bochk_currency_balance_map',
            '_normalize_bochk_subaccount_balance_map',
        )
        for name in names:
            assert getattr(identity, name) is getattr(helper, name)
            assert getattr(facade, name) is getattr(helper, name)
        assert identity._ii_bochk is importlib.import_module('app.services.investment.importing.brokers.bochk')
        assert identity._ii_hsbc_cash is importlib.import_module('app.services.investment.importing.brokers.hsbc.cash')
        assert identity.HSBC_CURRENCY_ALIASES is helper.HSBC_CURRENCY_ALIASES
        assert identity._decimal_to_str is helper._decimal_to_str
        assert facade._normalize_hsbc_currency_code(' rmb ') == 'CNH'
        assert facade._normalize_currency_balance_map({
            ' usd ': '1.25', 'USD': '-1.25', 'HKD': '2.30', 'bad': None,
        }) == {'USD': '0', 'HKD': '2.30'}
        assert facade._normalize_hsbc_currency_balance_map({
            ' cny ': '1.20', 'RMB': '2.30', 'HKD': '0.00', 'unknown': '9',
        }) == {'CNH': '3.50', 'HKD': '0.00'}
        assert facade._normalize_bochk_currency_balance_map({
            'CNY': '1.20', 'RMB': '2.30', 'USD': '0.00',
        }) == {'CNH': '3.50', 'USD': '0'}
        original = {'old:CNY': {
            'account_number': ' ISOLATED ', 'currency': 'CNY', 'amount': '0.00',
            'source': {'native': True, 'unknown': None},
        }}
        expected = {'ISOLATED:CNH': {
            'account_number': 'ISOLATED', 'currency': 'CNH', 'currency_raw': 'CNY',
            'amount': '0.00', 'source': {'native': True, 'unknown': None},
        }}
        assert facade._normalize_bochk_subaccount_balance_map(original) == expected
        assert original['old:CNY']['account_number'] == ' ISOLATED '
        assert 'currency_raw' not in original['old:CNY']
        for name in names[1:]:
            assert getattr(facade, name)(None) == {}
        print('cold import and currency contracts verified')
    """)
    environment = {
        **os.environ,
        "WORTHWARD_SETTINGS_STORE_DIR": str(tmp_path / "settings"),
        "WORTHWARD_MARKET_STORE_DIR": str(tmp_path / "market"),
        "WORTHWARD_COMPUTE_ROOT": str(tmp_path / "compute"),
        "WORTHWARD_REMOTE_MARKET_ACCESS": "disabled",
        "WORTHWARD_LONGBRIDGE_CLI_ACCESS": "disabled",
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    completed = subprocess.run(
        [sys.executable, "-B", "-c", probe, first_module],
        cwd=PROJECT_ROOT, env=environment, capture_output=True, text=True,
        timeout=60, check=False,
    )
    assert completed.returncode == 0, completed.stderr
    assert completed.stdout.strip() == "cold import and currency contracts verified"


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
