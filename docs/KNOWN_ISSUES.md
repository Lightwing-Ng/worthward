# Known issues and operating constraints

Documentation version: `v1.232.4`

This document is intentionally privacy-safe. It contains no broker account
identifiers, account-holder names, balances, position quantities, order
references, transaction descriptions, or copied statement content.

## Investment imports

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
- The optional cash and position boundary is user-entered at import time. It
  is dated to the captured fill boundary and never creates synthetic trades.
- When a Trade Notifications page mixes current-day time-only rows with dated
  history, select the displayed Hong Kong page date. It fills only the omitted
  current-day dates; dated rows remain independent broker evidence.
- Position boundary text accepts one ticker and non-negative quantity per line.
  Invalid or duplicate lines fail closed.
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

## Security

- Live Trading requires a PIN and access token supplied through local
  environment configuration. The repository configuration contains no default
  PIN.
- IBKR remains file-import-only. No broker session, credential, market-data,
  or order-routing transport is implemented.
