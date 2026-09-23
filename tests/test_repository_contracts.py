"""Repository documentation, cache-version, and isolation contracts.

Code version: v1.7.1
"""

from __future__ import annotations

from pathlib import Path
import re
import subprocess


PROJECT_ROOT = Path(__file__).resolve().parents[1]
JAVASCRIPT_ROOT = PROJECT_ROOT / "app/web/static/assets/js"
STATIC_ROOT = PROJECT_ROOT / "app/web/static"
CSS_ROOT = STATIC_ROOT / "assets/css"
E2E_ROOT = PROJECT_ROOT / "tests/e2e"
MAX_FIRST_PARTY_CODE_FILE_BYTES = 100 * 1024
FIRST_PARTY_CODE_SUFFIXES = frozenset(
    {".css", ".html", ".js", ".mjs", ".ps1", ".py", ".sh"}
)
FIRST_PARTY_CODE_SIZE_EXCLUSIONS = (
    Path("app/web/static/assets/js/vendor"),
)
FIRST_PARTY_CODE_ROOTS = (
    Path("main.py"),
    Path("app"),
    Path("strategies"),
    Path("scripts"),
    Path("tests"),
)
SHARED_STATIC_HOUSEKEEPING_CONTRACT = (
    PROJECT_ROOT.parent / "shared_docs" / "SHARED_STATIC_FILE_HOUSEKEEPING.md"
)
SHARED_UI_TYPOGRAPHY_CONTRACT = (
    PROJECT_ROOT.parent / "shared_docs" / "SHARED_UI_TYPOGRAPHY_CONTRACT.md"
)
EXTERNAL_DOCUMENTATION_CONTRACTS = frozenset(
    {
        SHARED_STATIC_HOUSEKEEPING_CONTRACT,
        SHARED_UI_TYPOGRAPHY_CONTRACT,
    }
)

APP_CSS_IMPORT_ORDER = (
    "foundation/fonts.css",
    "foundation/tokens.css",
    "layout/shell.css",
    "components/forms.css",
    "components/live-marker.css",
    "components/collapse.css",
    "components/process-list.css",
    "components/resizer.css",
    "components/tables.css",
    "views/workspace.css",
    "views/settings.css",
    "views/settings-sections.css",
    "views/trade.css",
    "views/investment.css",
    "views/investment-tables.css",
    "utilities/responsive.css",
    "foundation/motion.css",
)

APP_SCRIPT_LOAD_ORDER = (
    "assets/js/app/chart-export.js",
    "assets/js/app/navigation.js",
    "assets/js/app/workspace-enhancements.js",
    "assets/js/app/workspace-hydration.js",
    "assets/js/app/ticker-controls.js",
    "assets/js/app/select-controls.js",
    "assets/js/app/date-controls.js",
    "assets/js/app/range-controls.js",
    "assets/js/app/strategy-controls.js",
    "assets/js/app.js",
)

DOCUMENTATION_ENTRYPOINTS = (
    *sorted((PROJECT_ROOT / "docs").glob("*.md")),
    PROJECT_ROOT / "README.md",
    PROJECT_ROOT / "AGENTS.md",
    PROJECT_ROOT / "SHARED_UI_LAYOUT_CONTRACT.md",
    *sorted(STATIC_ROOT.rglob("*.md")),
)

VERSIONED_DOCUMENTS = (
    PROJECT_ROOT / "README.md",
    PROJECT_ROOT / "SHARED_UI_LAYOUT_CONTRACT.md",
    *(
        path
        for path in sorted((PROJECT_ROOT / "docs").glob("*.md"))
        if path.name != "AGENTS.md"
    ),
)

MARKDOWN_LINK_PATTERN = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
CODE_VERSION_PATTERN = re.compile(r"Code version:\s*(v\d+\.\d+\.\d+)")
DOCUMENT_VERSION_PATTERN = re.compile(
    r"Documentation version:[ \t]*`?v\d+\.\d+\.\d+`?(?=\s|$)"
)
MODULE_IMPORT_PATTERN = re.compile(
    r"\bfrom\s+['\"](?P<path>\.{1,2}/[^'\"]+\.js)\?v=(?P<query>[^'\"]+)['\"]"
)
TEMPLATE_ASSET_PATTERN = re.compile(
    r"filename='(?P<path>assets/(?:css|js)/[^']+)'[^\n]*"
    r"v=version\s*~\s*'[^']*(?P<version>v\d+\.\d+\.\d+)'"
)
E2E_RESOURCE_VERSION_PATTERN = re.compile(
    r"url\.pathname\.endsWith\(['\"]/(?P<path>assets/(?:css|js)/[^'\"]+)['\"]\)"
    r"[\s\S]{0,200}?"
    r"url\.searchParams\.get\(['\"]v['\"]\)[^'\"\n]{0,60}"
    r"['\"](?P<query>[^'\"]+)['\"]"
)
CSS_IMPORT_PATTERN = re.compile(
    r'@import\s+url\(["\']\./(?P<path>[^"\']+\.css)\?v=(?P<query>[^"\']+)["\']\);'
)
APP_FALLBACK_MODULE_PATTERN = re.compile(
    r'\["WORTHWARD_APP_[A-Z_]+", "(?P<path>app/[^"]+\.js)", "(?P<query>[^"]+)"\]'
)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _code_version(path: Path) -> str:
    match = CODE_VERSION_PATTERN.search(_read(path))
    assert match is not None, f"Missing Code version in {path.relative_to(PROJECT_ROOT)}"
    return match.group(1)


def _tracked_paths() -> tuple[Path, ...]:
    completed = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=PROJECT_ROOT,
        check=True,
        capture_output=True,
    )
    return tuple(
        Path(raw_path.decode("utf-8"))
        for raw_path in completed.stdout.split(b"\0")
        if raw_path
    )


def _first_party_code_paths() -> tuple[Path, ...]:
    candidates = set(_tracked_paths())
    for relative_root in FIRST_PARTY_CODE_ROOTS:
        source_root = PROJECT_ROOT / relative_root
        if source_root.is_file():
            candidates.add(relative_root)
            continue
        if source_root.is_dir():
            candidates.update(
                path.relative_to(PROJECT_ROOT)
                for path in source_root.rglob("*")
                if path.is_file()
            )
    return tuple(sorted(candidates))


def test_first_party_code_files_stay_within_100_kib() -> None:
    oversized: list[str] = []
    for relative_path in _first_party_code_paths():
        if relative_path.suffix.lower() not in FIRST_PARTY_CODE_SUFFIXES:
            continue
        if any(
            relative_path == excluded_root
            or relative_path.is_relative_to(excluded_root)
            for excluded_root in FIRST_PARTY_CODE_SIZE_EXCLUSIONS
        ):
            continue
        source_path = PROJECT_ROOT / relative_path
        if not source_path.is_file():
            continue
        size = source_path.stat().st_size
        if size > MAX_FIRST_PARTY_CODE_FILE_BYTES:
            oversized.append(f"{relative_path}: {size:,} bytes")

    assert oversized == [], (
        f"First-party code files must not exceed "
        f"{MAX_FIRST_PARTY_CODE_FILE_BYTES:,} bytes:\n"
        + "\n".join(oversized)
    )


def test_app_context_factories_load_before_the_composition_root() -> None:
    base_template = _read(PROJECT_ROOT / "app/web/templates/base.html")
    positions = [base_template.index(asset_path) for asset_path in APP_SCRIPT_LOAD_ORDER]

    assert positions == sorted(positions)

    app_source = _read(JAVASCRIPT_ROOT / "app.js")
    fallback_modules = tuple(APP_FALLBACK_MODULE_PATTERN.finditer(app_source))
    assert tuple(f"assets/js/{match.group('path')}" for match in fallback_modules) == (
        APP_SCRIPT_LOAD_ORDER[:-1]
    )
    for match in fallback_modules:
        module_path = JAVASCRIPT_ROOT / match.group("path")
        assert match.group("query").endswith(_code_version(module_path))


def test_price_compare_entry_consumes_the_complete_session_axis_contract() -> None:
    runtime_source = _read(JAVASCRIPT_ROOT / "price-compare/runtime.js")
    entry_source = _read(JAVASCRIPT_ROOT / "price-compare.js")
    runtime_contract = re.search(
        r"\n\t\treturn \{\n(?P<body>.*?)\n\t\t\};\n\t\};"
        r"\n\n\tconst createChipRevealController",
        runtime_source,
        re.DOTALL,
    )
    entry_contract = re.search(
        r"\tconst \{\n(?P<body>.*?)\n\t\} = "
        r"priceCompareRuntime\.createSessionAxis\(",
        entry_source,
        re.DOTALL,
    )

    assert runtime_contract is not None
    assert entry_contract is not None
    shorthand_property_pattern = re.compile(
        r"^\s*([A-Za-z_$][A-Za-z0-9_$]*),\s*$", re.MULTILINE
    )
    runtime_properties = tuple(
        shorthand_property_pattern.findall(runtime_contract.group("body"))
    )
    entry_properties = tuple(
        shorthand_property_pattern.findall(entry_contract.group("body"))
    )

    assert entry_properties == runtime_properties


def test_documentation_entrypoints_exist_and_local_links_resolve() -> None:
    for markdown_path in DOCUMENTATION_ENTRYPOINTS:
        assert markdown_path.is_file(), markdown_path.relative_to(PROJECT_ROOT)
        for raw_target in MARKDOWN_LINK_PATTERN.findall(_read(markdown_path)):
            target = raw_target.strip().strip("<>").split("#", 1)[0].strip()
            if not target or target.startswith(("http://", "https://", "mailto:")):
                continue
            resolved_target = (
                Path(target)
                if Path(target).is_absolute()
                else markdown_path.parent / target
            ).resolve()
            if resolved_target in EXTERNAL_DOCUMENTATION_CONTRACTS:
                # The shared desktop contract is intentionally external to CI checkouts.
                continue
            assert resolved_target.is_relative_to(PROJECT_ROOT), (
                f"Local link escapes the repository in "
                f"{markdown_path.relative_to(PROJECT_ROOT)}: {raw_target}"
            )
            assert resolved_target.exists(), (
                f"Broken local link in {markdown_path.relative_to(PROJECT_ROOT)}: "
                f"{raw_target}"
            )


def test_canonical_documents_keep_explicit_revision_markers() -> None:
    for markdown_path in VERSIONED_DOCUMENTS:
        assert DOCUMENT_VERSION_PATTERN.search(_read(markdown_path)), (
            f"Missing Documentation version in {markdown_path.relative_to(PROJECT_ROOT)}"
        )


def test_historical_changelog_declares_authority_and_privacy_boundaries() -> None:
    source = _read(PROJECT_ROOT / "docs/INVESTMENT_FRONTEND_CHANGELOG.md")

    assert "historical record, not a current implementation contract" in source
    assert "must not contain user account identifiers" in source


def test_first_party_module_cache_keys_match_imported_code_versions() -> None:
    for source_path in JAVASCRIPT_ROOT.rglob("*.js"):
        for match in MODULE_IMPORT_PATTERN.finditer(_read(source_path)):
            imported_path = (source_path.parent / match.group("path")).resolve()
            assert imported_path.is_file(), (
                f"Missing import target in {source_path.relative_to(PROJECT_ROOT)}: "
                f"{match.group('path')}"
            )
            expected_version = _code_version(imported_path)
            assert match.group("query").endswith(expected_version), (
                f"Stale cache key in {source_path.relative_to(PROJECT_ROOT)} for "
                f"{imported_path.relative_to(PROJECT_ROOT)}: {match.group('query')} "
                f"!= {expected_version}"
            )


def test_template_cache_keys_match_first_party_code_versions() -> None:
    template_root = PROJECT_ROOT / "app/web/templates"
    for template_path in template_root.rglob("*.html"):
        for match in TEMPLATE_ASSET_PATTERN.finditer(_read(template_path)):
            asset_path = STATIC_ROOT / match.group("path")
            assert asset_path.is_file(), (
                f"Missing asset in {template_path.relative_to(PROJECT_ROOT)}: "
                f"{match.group('path')}"
            )
            assert match.group("version") == _code_version(asset_path), (
                f"Stale cache key in {template_path.relative_to(PROJECT_ROOT)} for "
                f"{asset_path.relative_to(PROJECT_ROOT)}"
            )


def test_e2e_resource_version_assertions_match_first_party_code_versions() -> None:
    for e2e_path in E2E_ROOT.rglob("*.mjs"):
        for match in E2E_RESOURCE_VERSION_PATTERN.finditer(_read(e2e_path)):
            asset_path = STATIC_ROOT / match.group("path")
            assert asset_path.is_file(), (
                f"Missing E2E resource target in {e2e_path.relative_to(PROJECT_ROOT)}: "
                f"{match.group('path')}"
            )
            expected_version = _code_version(asset_path)
            asserted_query = match.group("query")
            assert asserted_query.endswith(expected_version) or asserted_query.endswith(
                expected_version.removeprefix("v")
            ), (
                f"Stale E2E resource version in {e2e_path.relative_to(PROJECT_ROOT)} for "
                f"{asset_path.relative_to(PROJECT_ROOT)}: {asserted_query} != "
                f"{expected_version}"
            )


def test_app_css_import_manifest_keeps_documented_order_and_existing_targets() -> None:
    manifest_path = CSS_ROOT / "app.css"
    imports = list(CSS_IMPORT_PATTERN.finditer(_read(manifest_path)))

    assert tuple(match.group("path") for match in imports) == APP_CSS_IMPORT_ORDER
    for match in imports:
        target_path = CSS_ROOT / match.group("path")
        assert target_path.is_file(), (
            f"Missing CSS import target in {manifest_path.relative_to(PROJECT_ROOT)}: "
            f"{match.group('path')}"
        )
        assert match.group("query").strip(), (
            f"Missing CSS cache query in {manifest_path.relative_to(PROJECT_ROOT)} for "
            f"{match.group('path')}"
        )


def test_e2e_launcher_copies_only_tracked_logo_assets() -> None:
    source = _read(PROJECT_ROOT / "scripts/run_e2e_app.sh")

    assert 'git -C "$ROOT_DIR" ls-files -z -- market_store/logos' in source
    assert 'cp -R "$ROOT_DIR/market_store/logos"' not in source


def test_retired_entrypoints_and_local_audit_tombstones_are_absent() -> None:
    assert not (PROJECT_ROOT / "scripts/reconcile_longbridge_statement.py").exists()
    assert not (PROJECT_ROOT / "playwright.reuse.config.mjs").exists()
    assert not (PROJECT_ROOT / "market_cap_compare.html").exists()
    assert not (PROJECT_ROOT / "grid_trading.html").exists()
    assert not (
        PROJECT_ROOT / "app/web/templates/market_cap_compare.html"
    ).exists()
    assert not (
        PROJECT_ROOT / "app/web/templates/grid_trading.html"
    ).exists()
    assert not (PROJECT_ROOT / "docs/GROK_ACCOUNTING_V2_INDEPENDENT_AUDIT.md").exists()
    assert not (PROJECT_ROOT / "docs/GROK_ACCOUNTING_V2_INDEPENDENT_AUDIT.json").exists()
    assert "def write_investment_payload(" not in _read(PROJECT_ROOT / "app/web/runtime.py")
    assert "def authenticate_longbridge_cli_with_auth_code(" not in _read(
        PROJECT_ROOT / "app/infrastructure/longbridge_cli.py"
    )


def test_retired_bearer_asset_transport_symbols_are_absent() -> None:
    retired_symbols = (
        "_call_longbridge_asset_api",
        "LONGBRIDGE_OPENAPI_BASE_URL",
    )

    for source_path in (PROJECT_ROOT / "app").rglob("*.py"):
        source = _read(source_path)
        for retired_symbol in retired_symbols:
            assert retired_symbol not in source, (
                f"Retired Bearer asset transport symbol {retired_symbol} restored in "
                f"{source_path.relative_to(PROJECT_ROOT)}"
            )


def test_duplicate_copy_ignore_rule_is_narrow() -> None:
    source = _read(PROJECT_ROOT / ".gitignore")

    assert ".coverage [0-9]*" in source
    assert "**/* [0-9]*" not in source


def test_investment_runtime_entry_version_matches_source() -> None:
    path = JAVASCRIPT_ROOT / "investment.js"
    match = re.search(r"entry:\s*['\"](v\d+\.\d+\.\d+)['\"]", _read(path))
    assert match is not None
    assert match.group(1) == _code_version(path)
