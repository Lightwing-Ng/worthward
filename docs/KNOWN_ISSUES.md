# Known issues and operating constraints

Documentation version: `v1.234.0`

This document is intentionally privacy-safe. It contains no broker account
identifiers, account-holder names, balances, position quantities, order
references, transaction descriptions, or copied statement content.

## Investment imports

- Import-complete `Transfer review` feedback is scoped to source rows that
  became actionable during that import. Pre-existing `Unbound` rows remain
  available in Transaction history but are not repeated as work created by an
  unrelated later import; the comparison uses the completed post-commit
  transaction render rather than a pre-import frontend count.

- Schwab transaction exports classify `Non-Qualified Div` as dividend income
  and `NRA Tax Adj` or related withholding-tax actions as
  `foreign_tax_withholding`; date-only exports retain day-level timestamp
  provenance, while an explicit intraday datetime column is preserved when
  present. Incremental re-imports also canonicalize legacy persisted
  `nra_tax_adj` records before duplicate matching and retain the old type as
  source provenance. When Schwab supplies only a date, same-day buy and sell
  chronology follows the inferred source row direction; an explicit user
  confirmation takes precedence in both persisted replay and browser replay.
  A linked dividend or withholding row displays its canonical ticker before
  the preserved broker description.
- IBKR GainsKeeper imports retain `BUYOTHER` and `SELLOTHER` money-market
  transactions with their immutable FITIDs, exact source timestamps, and
  cash values; legacy stored GainsKeeper timestamps are normalized to the
  source's America/New_York wall-clock convention during incremental merge.
- IBKR web paste is supplemental evidence. Matching CSV or GainsKeeper rows
  remain the higher-precision source when they are available.
- A compact Orders aggregate only supersedes full-page split fills when the
  declared fill count and all signed economic fields reconcile exactly;
  otherwise every independently captured filled row remains in the ledger.
- Immutable GainsKeeper split fills supersede a matching provisional compact
  web aggregate when their unique FITIDs, split count, identity fields, signed
  quantity, and gross trade value reconcile exactly. GainsKeeper commission
  and net-cash values remain authoritative when they differ from the web
  aggregate.
- The optional cash and position boundary comes from a paired IBKR Your
  Holdings page paste. Its account must match Trade Notifications; its raw
  text is retained as immutable evidence, it is dated to the captured fill
  boundary, and it never creates synthetic trades.
- When a Trade Notifications page mixes current-day time-only rows with dated
  history, select the displayed Hong Kong page date. It fills only the omitted
  current-day dates; dated rows remain independent broker evidence.
- Your Holdings parsing requires one account, recognizable Instrument/Position
  rows, and a base-currency Cash Holdings row. Invalid, duplicate, or
  cross-account evidence fails closed.
- Broker account validation is opt-in through local environment configuration;
  no personal account number is stored in source code.
- Local source artifacts may contain sensitive financial evidence. Keep the
  local settings store and exported statements outside Git and backups.

## Accounting behavior

- Unknown cost basis, incomplete history, and conflicting broker snapshots are
  represented explicitly instead of being replaced with guessed values.
- Mixed-broker snapshots remain scoped by broker and account. Aggregation is
  disabled when the evidence boundary is ambiguous.
- A broker performance snapshot and a position snapshot have independent
  as-of boundaries. Later trades supplement realized P&L from the performance
  boundary while the position snapshot validates inventory; the newer position
  date cannot hide those trades.
- Security-transfer links require explicit evidence and do not invent a
  carried cost basis.
- HSBC settled-order balances use the final chronological principal or fee
  posting. When copy/paste order conflicts with the official USD Savings CSV,
  the CSV's continuous balance sequence is authoritative.
- Current broker cash snapshots are presentation endpoints. HSBC historical
  settlement corrections use the pre-projection broker ledger, so a later
  mixed-broker current cash refresh cannot cancel earlier settled proceeds.

## Security

- Live Trading requires a PIN and access token supplied through local
  environment configuration. The repository configuration contains no default
  PIN.
- IBKR remains file-import-only. No broker session, credential, market-data,
  or order-routing transport is implemented.
