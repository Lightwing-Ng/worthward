"""The workspace runtime namespace is an explicit, drift-checked contract.

Code version: v1.0.0
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from app.web import runtime
from app.web import runtime_workspace
from app.web.runtime_workspace_dependencies import (
    WORKSPACE_RUNTIME_DEPENDENCIES,
    build_workspace_dependencies,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_MODULES = (
    "app/web/runtime_workspace.py",
    "app/web/runtime_workspace_finalize.py",
    "app/web/runtime_workspace_history.py",
    "app/web/runtime_workspace_request.py",
    "app/web/runtime_workspace_response.py",
)
NAMESPACE_VARIABLES = frozenset({"c", "ctx"})


def _referenced_dependency_names() -> set[str]:
    referenced: set[str] = set()
    for relative_path in WORKSPACE_MODULES:
        tree = ast.parse((PROJECT_ROOT / relative_path).read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Attribute)
                and isinstance(node.value, ast.Name)
                and node.value.id in NAMESPACE_VARIABLES
            ):
                referenced.add(node.attr)
    return referenced


def test_declared_dependencies_match_the_names_the_modules_actually_read() -> None:
    referenced = _referenced_dependency_names()
    declared = set(WORKSPACE_RUNTIME_DEPENDENCIES)

    assert referenced - declared == set(), "Undeclared workspace runtime dependency"
    assert declared - referenced == set(), "Declared workspace dependency is unused"


def test_the_workspace_module_consumes_the_declared_contract() -> None:
    assert (
        runtime_workspace.WORKSPACE_RUNTIME_DEPENDENCIES
        is WORKSPACE_RUNTIME_DEPENDENCIES
    )
    assert runtime_workspace.build_workspace_dependencies is build_workspace_dependencies


def test_the_declaration_is_sorted_and_free_of_duplicates() -> None:
    assert list(WORKSPACE_RUNTIME_DEPENDENCIES) == sorted(
        set(WORKSPACE_RUNTIME_DEPENDENCIES)
    )


def test_every_declared_dependency_resolves_in_the_composed_runtime_context() -> None:
    context = runtime._build_runtime_context()
    for builder in (
        runtime.build_foundation_context,
        runtime.build_comparison_context,
        runtime.build_backtest_settings_context,
    ):
        context.update(builder(context))

    namespace = build_workspace_dependencies(context)

    for name in WORKSPACE_RUNTIME_DEPENDENCIES:
        assert hasattr(namespace, name), name


def test_an_incomplete_context_fails_loudly_instead_of_binding_late() -> None:
    with pytest.raises(KeyError, match="Missing workspace runtime dependencies"):
        build_workspace_dependencies({})


def test_the_namespace_carries_nothing_beyond_the_declaration() -> None:
    context = {name: object() for name in WORKSPACE_RUNTIME_DEPENDENCIES}
    context["unrelated_runtime_name"] = object()

    namespace = build_workspace_dependencies(context)

    assert set(vars(namespace)) == set(WORKSPACE_RUNTIME_DEPENDENCIES)
    assert not hasattr(namespace, "unrelated_runtime_name")
