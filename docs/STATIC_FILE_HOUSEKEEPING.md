# Static-file housekeeping project entrypoint

Documentation version: `v1.0.0`

This repository follows the canonical cross-project contract at
[`../../SHARED_STATIC_FILE_HOUSEKEEPING.md`](../../SHARED_STATIC_FILE_HOUSEKEEPING.md). That
document owns the numbered-copy definition, evidence requirements, protected boundaries, action
matrix, recoverable cleanup rule, and final-scan requirement. Do not duplicate those rules here.

## Mandatory project rule

After any operation that may create, copy, rename, export, compile, or restore a static file, run
the shared numbered-copy housekeeping workflow before continuing to another task and before a
commit, handoff, or final response. If parallel work touched both repositories, scan both roots.

Never delete a file only because its name contains ` 2`, ` 3`, or another number. An exact-byte,
untracked or reproducible duplicate may be moved to recoverable Trash/quarantine only after the
primary-file, Git-state, active-process, protected-path, and final-rescan checks pass.

## antigravity-specific boundary

Preserve `settings_store/`, non-bundled `market_store/`, broker exports, credentials, `.lb-home/`,
the user-owned port `8688`, and the isolated E2E runtime while it is active. The local
`__pycache__/` and `*.pyc` classes are reproducible, but they still require the exact-byte and
process-ownership checks from the shared contract.

The shared contract is the only long-form source. Update this entrypoint and the canonical
[`docs/README.md`](README.md) map whenever the cross-project housekeeping rule changes.

