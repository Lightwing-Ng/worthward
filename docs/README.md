# Documentation map and repository ownership

Documentation version: `v1.0.2`

This file is the entrypoint for project documentation. It defines which files
are authoritative, which records are historical, and how local artifacts must
be classified before an agent edits or removes them.

## Authority order

Use the narrowest applicable current contract. When two sources disagree,
verify the behavior in source code and tests, then repair the stale document in
the same change.

| Priority | Document | Role |
| --- | --- | --- |
| 1 | [`AGENTS.md`](AGENTS.md) | Safety, workflow, versioning, and quality-gate policy |
| 2 | [`README.md`](README.md) | Documentation ownership, authority order, and cleanup classification |
| 3 | [`../README.md`](../README.md) | Operator-facing setup, supported features, and current routes |
| 4 | [`ARCHITECTURE.md`](ARCHITECTURE.md) | Runtime boundaries, data ownership, and domain invariants |
| 5 | [`TESTING.md`](TESTING.md) | Supported commands, isolation, measured baselines, and test topology |
| 6 | [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) | Current limitations and operating constraints |
| 7 | [`COMPATIBILITY.md`](COMPATIBILITY.md) | Canonical routes, retained aliases, retired renderers, and reserved assets |
| 8 | [`SHARED_UI_WORKFLOW.md`](SHARED_UI_WORKFLOW.md) | Conditional workflow for shared UI changes |

[`INVESTMENT_FRONTEND_CHANGELOG.md`](INVESTMENT_FRONTEND_CHANGELOG.md) is a
historical record. It can explain why a change was made, but it is not a current
implementation contract. Git history is the authority for deleted historical
files and superseded code.

Component documentation applies only within its directory:

- [`../app/web/static/assets/css/README.md`](../app/web/static/assets/css/README.md)
- [`../app/web/static/assets/fonts/README.md`](../app/web/static/assets/fonts/README.md)
- [`../app/web/static/images/SF_SYMBOLS.md`](../app/web/static/images/SF_SYMBOLS.md)

## Required reading paths

- Cross-cutting work: this map, `AGENTS.md`, the root README, Architecture,
  Testing, Known Issues, and Compatibility.
- Shared UI work: also read `SHARED_UI_WORKFLOW.md` and the external shared UI
  ledger named there.
- CSS, font, or icon work: also read the nearest component README or catalog.
- Investment import or accounting work: re-read the relevant Architecture and
  Testing sections before touching persistence.
- Handoff: use [`HANDOFF_TEMPLATE.md`](HANDOFF_TEMPLATE.md) and report exact
  commands and outcomes rather than inferred status.

## Repository ownership and cleanup classes

Being ignored by Git or having no `rg` references does not make a path safe to
delete. Classify it first and check for an active process with `ps` and `lsof`.

| Class | Representative paths | Required treatment |
| --- | --- | --- |
| Protected local state | `settings_store/`, non-bundled `market_store/` data, `.lb-home/`, broker exports, credentials | Never rewrite or clean without explicit user scope; preserve byte-level financial evidence |
| User and tool configuration | `.idea/`, `.vercel/`, `.vercelignore` | Preserve unless the user explicitly retires the owning tool |
| Git repository metadata | `.git/`, worktree registrations, the live `.git/index` | Never clean recursively; move an exact collision copy such as `index 2` only after confirming the live index is valid and no Git process owns it |
| Sensitive local review output | `outputs/` | Not canonical documentation; inspect before removal and retain evidence the user has not authorized for cleanup |
| Disposable task scratch | `tmp/`, `.codex_tmp/` | Remove only after confirming no active process or unfinished task owns it |
| Reproducible test output | `test-results/`, `playwright-report/`, `.coverage*`, `coverage.json`, `htmlcov/` | Safe to recreate; retain failed-run evidence until the result has been recorded |
| Reproducible caches | `__pycache__/`, `*.pyc`, `.pytest_cache/`, `.ruff_cache/`, stale `.dbg/` captures | Clean only when no test or debug process is using them; debug captures may contain sensitive values |
| Installed dependencies | `node_modules/` | Reproducible but not garbage during an active development checkout |
| Bundled source assets | tracked `market_store/logos/`, static images, templates, strategy modules | Treat as source; consult Compatibility and component catalogs before deletion |

The E2E launcher owns port `8699` and an isolated store under
`test-results/runtime-store`. The user normally owns port `8688`. Do not stop,
reuse, or replace a user-owned service merely to run a clean test. An
agent-started server must be stopped before handoff.

## Documentation maintenance rules

- Update factual or contractual Markdown and its `Documentation version` in
  the same change.
- Record a test baseline only from a dated completed command. A collection
  count is inventory, not a pass result.
- Keep private account identifiers, balances, positions, transaction dates,
  and acceptance datasets out of versioned documentation.
- Do not copy ignored `outputs/**/*.md`, `.pytest_cache/README.md`, terminal
  transcripts, or transient audit reports into the authority chain.
- Link to the current contract instead of duplicating it. One fact should have
  one maintained owner.
- When a tracked file appears unused, check dynamic loading, route aliases,
  template maps, strategy discovery, and reserved-asset catalogs before
  removal.

## Release metadata

`config.toml` owns the application version and About-page update date. Change
those values only as part of an explicit application release. Documentation
housekeeping and file-level `Code version` bumps do not implicitly create a
release.
