# Agent handoff template

Documentation version: `v1.2.0`

Use this structure for a task handoff. It is a template, not a record of the
current working tree. Never put private account values, broker evidence, access
tokens, or production-store contents in a handoff.

## Required handoff record

```markdown
# Outcome

One sentence stating whether the requested outcome is complete, partially
complete, or blocked.

## Scope and preserved state

- User request:
- Worktree path and branch:
- Starting HEAD and starting `git status --short`:
- Paths intentionally changed:
- Pre-existing dirty files preserved:
- Concurrent agents or tasks, their file ownership, and coordination state:
- Protected stores touched: none, or exact authorized paths and operation
- User-owned services observed:
- Agent-owned services stopped:

## Changes

- File or subsystem: behavior and reason
- Removed files: why each was obsolete, and recovery location if applicable
- Documentation versions updated:
- Commit state: uncommitted, or exact commit IDs created by this task

## Verification

- `exact command`: exit code and exact pass/fail/skip counts
- Browser or rendered verification: route, viewport, and observed result
- Documentation link and contract checks:
- Selected verification groups, file filters, and ML inclusion or exclusion:
- Why that scope covers the affected behavior; any untested affected boundary:
- Verification completion time and final source state it covered:
- Complete gate, only if explicitly run with `--full`:
- Changes made after the last verification, with focused checks for each:
- E2E lock conflicts: owner, exit status `73`, coordination, and successful retry:

## Remaining work or risks

- Independent failure or unresolved decision:
- Reproduction command or evidence location:
- Safe next action:

## Rollback and recovery

- Final HEAD and final `git status --short`:
- Exact source files, commit, or patch to reverse; never use a broad reset in a
  dirty or shared worktree:
- Recoverable local files moved to:
```

## Completion checklist

- Re-read `git status --short` and inspect the final diff.
- Record the starting and final HEAD, branch, worktree path, and Git status.
- Distinguish pre-existing changes from task changes and state whether each
  change is committed.
- Name concurrent agents or tasks and their owned files. Do not overwrite or
  roll back their changes.
- Run `git diff --check`.
- Run the smallest relevant tests and assemble the affected layers through
  `./scripts/check.sh --group ...` and its file selectors. Follow
  [`TESTING.md`](TESTING.md) for ML inclusion and complete-gate selection;
  unrelated frontend or real model execution is not a handoff requirement.
- Confirm that the selected checks cover the last concurrent source change.
  State which later files have only focused verification. Reserve complete-gate
  claims for a completed `--full` run.
- Report a collection count only as inventory; report a pass count only from a
  completed run with a known exit status.
- Treat E2E exit status `73` as an ownership conflict, not a product failure.
  Record the owner, wait for release, and retry through the supported wrapper.
- Confirm port `8699` and other agent-owned processes are stopped. Do not stop
  the user's port `8688` service unless explicitly authorized.
- Record whether `settings_store/`, `market_store/`, `outputs/`, `tmp/`,
  `.lb-home/`, or broker evidence changed.
- Verify changed Markdown links and version markers.
- Keep private acceptance evidence out of Git and out of the handoff.
- Roll back only exact task-owned files or commits; never use a broad reset to
  clean a shared working tree.
- State every remaining failure plainly; do not collapse an independent gate
  failure into a claim of completion.
