# Shared UI workflow

Documentation version: `v1.0.1`

This is the short entrypoint for shared visual and interaction work. The only
long-form synchronization state lives in:

`/Users/example/Desktop/SHARED_UI_SYNC.md`

## Read order

1. Read [`../SHARED_UI_LAYOUT_CONTRACT.md`](../SHARED_UI_LAYOUT_CONTRACT.md).
2. Read this file.
3. Read the central ledger's `Fast path for agents` section and the matching row.
4. For a cross-cutting change, follow `docs/AGENTS.md` and read `README.md`,
   `docs/ARCHITECTURE.md`, `docs/TESTING.md`, and `docs/KNOWN_ISSUES.md`.
5. Inspect the current `antigravity` implementation and the named
   `CacheLikesFromTwitter` implementation before editing either one.

## Contract

- `antigravity` is the canonical complete baseline and the final convergence target.
  Shared improvements discovered anywhere must be promoted here.
- CacheLikesFromTwitter is an adapter: its product-specific routes and markup may
  differ, but its shared tokens, states, responsive behavior, and accessibility
  invariants must remain aligned.
- A Cache-first improvement is a `Candidate review`, not a finished synchronization.
  Review and promote it here before the ledger can say `Synchronized`.
- If only this repository is authorized, do not edit the sibling. Set the ledger row
  to `Pending` and include the exact sibling-sync reminder in the handoff.
- Never declare parity from source text, one green test, or visual similarity alone.

## Verification minimum

Preserve unrelated dirty files and record the component row, paths, versions or
commit, invariant, focused checks, and live route evidence. Run focused tests first;
run `./scripts/check.sh` before handoff when shared tokens, shell, responsive
behavior, motion, or accessibility behavior changed. For visual or interaction work,
verify the production DOM at desktop and narrow widths in both projects.

Before handoff, report exact commands, pass/fail counts, live verification, and any
unrelated failures. Update the central ledger only after both projects have evidence.
