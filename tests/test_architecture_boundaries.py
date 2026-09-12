"""Executable dependency and web-facade architecture contracts.

Code version: v1.3.1
"""

from __future__ import annotations

import ast
import json
from pathlib import Path
import subprocess
import sys


PROJECT_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = PROJECT_ROOT / "app"
FORBIDDEN_IMPORTS = {
    "core": (
        "app.infrastructure",
        "app.services",
        "app.web",
        "app.beta",
        "scripts",
        "strategies",
    ),
    "models": (
        "app.core",
        "app.infrastructure",
        "app.services",
        "app.web",
        "app.beta",
        "scripts",
        "strategies",
    ),
    "infrastructure": (
        "app.services",
        "app.web",
        "app.beta",
        "scripts",
        "strategies",
    ),
    "services": ("app.web", "app.beta"),
}
ROUTE_IMPORTS = frozenset({"__future__", "flask", "app.web.runtime"})


def _import_from_modules(
        node: ast.ImportFrom,
        package: tuple[str, ...],
) -> list[str]:
    if node.level:
        prefix = package[:len(package) - node.level + 1]
        suffix = tuple((node.module or "").split(".")) if node.module else ()
        base_module = ".".join((*prefix, *suffix))
    else:
        base_module = node.module or ""
    if not base_module:
        return []
    imported = [base_module]
    imported.extend(
        f"{base_module}.{alias.name}"
        for alias in node.names
        if alias.name != "*"
    )
    return imported


def _imported_modules(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    package = path.relative_to(PROJECT_ROOT).parent.parts
    modules: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            modules.extend(_import_from_modules(node, package))
    return modules


def _imports_application_composition_root(tree: ast.AST) -> bool:
    return any(
        (
            isinstance(node, ast.Import)
            and any(alias.name == "app" for alias in node.names)
        )
        or (
            isinstance(node, ast.ImportFrom)
            and node.level == 0
            and node.module == "app"
        )
        for node in ast.walk(tree)
    )


def _matches_module(module: str, prefix: str) -> bool:
    return module == prefix or module.startswith(f"{prefix}.")


def test_application_layers_only_import_inward() -> None:
    violations: list[str] = []
    for path in sorted(APP_ROOT.rglob("*.py")):
        relative = path.relative_to(APP_ROOT)
        layer = relative.parts[0]
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        if _imports_application_composition_root(tree):
            violations.append(f"{relative}: application composition root")
        if layer not in FORBIDDEN_IMPORTS:
            continue
        for module in _imported_modules(path):
            if any(
                _matches_module(module, forbidden)
                for forbidden in FORBIDDEN_IMPORTS[layer]
            ):
                violations.append(f"{relative}: {module}")

    assert violations == []


def test_import_from_parser_includes_absolute_and_relative_members() -> None:
    absolute = ast.parse("from app import web").body[0]
    relative = ast.parse("from .. import web").body[0]

    assert isinstance(absolute, ast.ImportFrom)
    assert isinstance(relative, ast.ImportFrom)
    assert _import_from_modules(absolute, ("app", "core")) == ["app", "app.web"]
    assert _import_from_modules(relative, ("app", "core")) == ["app", "app.web"]


def test_composition_root_detector_distinguishes_package_relative_imports() -> None:
    assert _imports_application_composition_root(ast.parse("import app"))
    assert _imports_application_composition_root(
        ast.parse("from app import create_app")
    )
    assert _imports_application_composition_root(ast.parse("from app import *"))
    assert not _imports_application_composition_root(
        ast.parse("import app.core.market_identity")
    )
    assert not _imports_application_composition_root(ast.parse("from .. import core"))


def test_route_modules_are_thin_runtime_registrars() -> None:
    for path in sorted((APP_ROOT / "web" / "routes").rglob("*.py")):
        assert all(
            any(_matches_module(module, allowed) for allowed in ROUTE_IMPORTS)
            for module in _imported_modules(path)
        ), path.name


def test_web_runtime_fields_match_builder_and_route_consumers() -> None:
    runtime_path = APP_ROOT / "web" / "runtime.py"
    tree = ast.parse(runtime_path.read_text(encoding="utf-8"), filename=str(runtime_path))
    runtime_class = next(
        node for node in tree.body
        if isinstance(node, ast.ClassDef) and node.name == "WebRuntime"
    )
    fields = {
        node.target.id
        for node in runtime_class.body
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name)
    }
    builder = next(
        node for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "build_web_runtime"
    )
    constructor = next(
        node for node in ast.walk(builder)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "WebRuntime"
    )
    builder_fields = {keyword.arg for keyword in constructor.keywords if keyword.arg}
    route_fields: set[str] = set()
    for path in sorted((APP_ROOT / "web" / "routes").rglob("*.py")):
        route_tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        route_fields.update(
            node.attr
            for node in ast.walk(route_tree)
            if isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id == "runtime"
        )

    assert fields == builder_fields == route_fields


def test_web_runtime_reuses_core_market_identity() -> None:
    runtime_path = APP_ROOT / "web" / "runtime.py"
    tree = ast.parse(runtime_path.read_text(encoding="utf-8"), filename=str(runtime_path))
    imported_names = {
        alias.name
        for node in tree.body
        if isinstance(node, ast.ImportFrom)
        and node.module == "app.core.market_identity"
        for alias in node.names
    }
    local_bindings = {
        node.name
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
    }
    local_bindings.update(
        node.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store)
    )
    local_bindings.update(
        node.arg
        for node in ast.walk(tree)
        if isinstance(node, ast.arg)
    )

    authority_names = {"infer_ticker_market", "market_timezone_for_ticker"}
    assert authority_names <= imported_names
    assert authority_names.isdisjoint(local_bindings)


def test_importing_core_does_not_eagerly_load_outer_layers() -> None:
    script = """
import json
import sys
import app.core.market_calendar
blocked = (
    "app.infrastructure",
    "app.services",
    "app.web",
    "app.beta",
    "scripts",
    "strategies",
)
print(json.dumps(sorted(
    name for name in sys.modules
    if name == "flask" or name.startswith("flask.") or name.startswith(blocked)
)))
"""
    completed = subprocess.run(
        [sys.executable, "-c", script],
        cwd=PROJECT_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    assert json.loads(completed.stdout) == []


def test_application_package_exports_only_the_public_facade() -> None:
    import app

    assert app.__all__ == (
        "INVESTMENT_IMPORT_MULTIPART_ALLOWANCE_BYTES",
        "MAX_INVESTMENT_IMPORT_REQUEST_BYTES",
        "create_app",
    )
