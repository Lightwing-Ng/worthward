# Agent guide compatibility pointer

Canonical agent guide: [`docs/AGENTS.md`](docs/AGENTS.md)

Shared UI synchronization ledger:
`/Users/example/Desktop/SHARED_UI_SYNC.md`

The following safety rules apply before reading the canonical guide:

- Preserve unrelated user changes; the worktree may be intentionally dirty.
- Never delete or rewrite local market data, broker credentials, or `settings_store/` without explicit instruction.
- Never write synthetic, fabricated, placeholder, sample, demo, E2E, or debugging records into production stores.
- IBKR is file-import-only; do not add direct broker transports, sessions, credentials, market-data, or order-routing integrations.
- Do not alter live-order authorization or default PIN behavior without explicit instruction.
