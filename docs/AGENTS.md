# Agent operating guide

The root [`AGENTS.md`](../AGENTS.md) is a compatibility pointer for agent
discovery. This file remains the canonical guide.

## Scope and safety

- Preserve unrelated user changes. The worktree is frequently dirty by design.
- Do not delete or rewrite local market data, broker credentials, or `settings_store/` unless the user explicitly requests it.
- Never write synthetic, fabricated, placeholder, inferred, sample, test-fixture, demo, E2E, or debugging records into the user's live production environment or production data stores. This prohibition applies even when code intends to restore the original file afterward.
- Tests and diagnostics that need writable data must use an isolated temporary store and isolated derived caches. Where a test exercises a production persistence path, assert that the real production file remains byte-for-byte unchanged.
- Do not invent missing financial records or values. Preserve an explicit unknown, validation error, or blocked import unless authoritative broker evidence supports the data.
- Treat investment import, cash replay, ticker lineage, and live-order authorization as high-risk domains.
- For HSBC pending-sell transaction history, model each visible row with a virtual post-trade holding snapshot obtained by reverse-replaying the authoritative broker position snapshot. Value those holdings with the last available close from that trading day's intraday series, fall back to the existing daily close when intraday data is unavailable, and calculate row Equity as displayed cash plus row Market value. This is an explicit display projection, not an assertion about the exact execution timestamp.
- IBKR is a file-import-only integration. Do not reintroduce Flex Web Service, Client Portal, Gateway, broker credentials, sessions, market-data, order-routing, or direct broker transports without an explicit user-directed architecture and security decision.
- Use American English for code comments and repository documentation.
- Follow the existing file-level `Code version:` convention for versioned source files. Do not bump it for comments, formatting, or documentation-only edits. Bump the patch component for a behavior-preserving refactor or localized bug fix, for example `v0.25.2` to `v0.25.3`. Bump the minor component and reset the patch component for a module-local public behavior, validation, persistence, security, or API-contract change, for example `v0.25.2` to `v0.26.0`. Bump the major component and reset lower components only for a coordinated cross-module breaking contract or schema migration. Increment exactly one component per coherent change and never skip versions merely to reflect task size.
- For a versioned Markdown document, bump its documentation version whenever factual or contractual content changes. Record test baselines only from a dated command result, never from an estimate.
- Investment equity replay is a high-risk accounting boundary. The replay
  timeline is ordered by the broker ledger booking date, with execution
  datetime used only as a same-day tie-breaker. A future-dated settlement
  balance must not overwrite the execution-day cash path. Confirmed internal
  cash-transfer bridges may correct historical chart continuity only; current
  Holdings Cash, Cash equivalents, and Total equity must remain tied to broker
  balances. Ending-cash and position snapshots may be applied only on or after
  their explicit as-of date.
- A user-confirmed broker P&L calibration is constrained to its explicit
  broker, account, ticker, and currency scope. It is neither a dated position
  or equity snapshot nor evidence of a reconstructed tax-lot history. Do not
  assign it an as-of date from an adjacent ledger artifact, and do not blend it
  into a later broker-native performance report.

## Manual launch ownership

- The user owns the final launch of this project from their own Terminal. The canonical command is `./scripts/run_app.sh` from the project root; direct `python3 main.py` is supported when the shell's `python3` resolves to Python `3.13` or `3.14`.
- The agent may temporarily start the application during debugging when necessary, but must stop that process before handoff and must not leave the application running in an opaque agent-managed or background process.
- Do not replace the user's manual launch workflow with an IDE task, hidden service, daemon, or other automatic startup mechanism.

## Required workflow

1. Read [`README.md`](../README.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), [`TESTING.md`](TESTING.md), and [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) before a cross-cutting change.
2. Before changing a UI pattern shared with
   `/Users/example/Desktop/CacheLikesFromTwitter`, read the single local synchronization
   ledger at `/Users/example/Desktop/SHARED_UI_SYNC.md`. Follow its component-specific
   leader/follower workflow: update the ledger whenever one project advances first, do
   not edit the sibling unless the task authorizes both projects, and include the ledger's
   required pending-sync reminder in the handoff until parity is verified.
3. Search with `rg` when available; otherwise use a recursive fallback such as
   `grep -R`, and inspect the current implementation before editing.
4. Reuse factories under `tests/factories/`; do not create another quote-profile, OHLC-frame, or backtest-result double in a test module.
5. Use canonical routes in new tests:
   - `/workspaces/compare`
   - `/workspaces/market-caps`
   - `/workspaces/prices`
   - `/workspaces/portfolio`
   - `/workspaces/dca`
   - `/workspaces/backtest`
   - `/workspaces/grid-trading`
   - `/trade/investment`
   - `/trade/live-trading`
   - `/settings/<section>`
6. Run the smallest relevant test first, then `./scripts/check.sh` before handoff.
7. Record intentional behavior changes in [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) or the relevant domain documentation.

## Quality boundaries

- Do not make a failing accounting test green merely by copying current output into the assertion. Establish the intended ledger invariant first.
- Legacy routes should be tested as redirects, not as canonical page renderers.
- Browser tests must not submit a real broker import or live order. Intercept the request or stop at client-side readiness.
- Keep E2E tests deterministic and independent of remote market-data availability.
- The current coverage baseline and improvement targets are documented in [`TESTING.md`](TESTING.md).
