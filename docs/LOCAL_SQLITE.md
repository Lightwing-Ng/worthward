# Local SQLite persistence

Documentation version: `v1.1.0`

This document owns the default persistence format for local structured runtime
data. The [Architecture guide](ARCHITECTURE.md) owns financial and market-data
meaning; the [investment ledger contract](INVESTMENT_SQLITE.md) owns its
specialized ledger representation and evidence boundary.

## Scope and ownership

Every active structured runtime store uses SQLite with a `.sqlite3` filename:

| Owner | Stored data |
| --- | --- |
| `market_store/` | Daily and intraday price history, dividends and volume, share history, stock splits, FX history, cached company profiles, and related structured market metadata |
| `settings_store/` | General and section settings, the investment and credit-card ledgers, private investment-evidence mappings, search results, ticker and strategy usage, and derived investment caches |
| Configured compute root | Training requests, status and result records, research state, leaderboards, manifests, and ordered evaluation/event streams |

The default readers and writers use SQLite directly. A missing or damaged
default SQLite database is not permission to silently restore an old Parquet
or JSON snapshot. Existing explicit legacy paths remain available for isolated
tests, controlled migration, and explicit interchange/export compatibility;
they do not establish a production dual-write or fallback policy.

Original broker evidence remains immutable `.bin` files with its existing
SHA-256 identity. Images, fonts, model weights, native provider files, logs,
`config.toml`, environment configuration, and Keychain credentials retain
their appropriate native formats. Explicit inputs and exported audit reports
are interchange artifacts rather than active runtime databases. This change
does not move credentials or alter broker/order authorization.

The standalone Bayesian runner's explicit `--job-runtime` also implements the
existing agenticContext cross-process file protocol. Its internal checkpoint,
progress, and result records are canonical SQLite databases. After each commit
and persisted readback, it exports the same fields and values to the three
consumer-required `checkpoint.json`, `progress.json`, and `result.json` paths.
These are protocol snapshots, equivalent to JSON API responses, and remain
interchange exceptions rather than application runtime stores. Do not archive
or remove snapshots still required by that external consumer. A resume request
may use an old standalone JSON checkpoint; when its canonical SQLite peer
exists, SQLite is authoritative and a damaged database never falls back to
JSON. Other training managers do not gain JSON state exports from this rule.

## Typed market frames

`app/infrastructure/frame_sqlite.py` stores Arrow IPC column blocks inside
SQLite. The active payload is not a Parquet file embedded in a database.
Blocks contain one column and at most 8,192 consecutive rows, compressed with
zstd. The root record preserves the exact serialized Arrow schema, including
field metadata and pandas metadata such as index representation and
`PANDAS_ATTRS`.

Migration reads existing Parquet data as an Arrow table without reconstructing
it through Python dictionaries or a replacement schema. This preserves column
order and types, timestamps and timezones, nulls, categories, numerical values,
row order, and duplicate row occurrences. Direct Arrow numeric data retains
its floating-point representation. Future DataFrame writes retain the existing
explicit index policy; a caller choosing `index=False` still deliberately
omits its pandas index. Frame attributes follow pandas' JSON metadata
convention rather than an invented serialization format.

The indexed `(column_ordinal, block_ordinal)` block key lets ordinary columns
fetch only requested columns and overlapping tail blocks. Dictionary-valued
columns also read their vocabulary-bearing blocks so empty projections and
tails retain unused categories and dictionary ordering. Empty dictionary columns
retain zero-row IPC blocks; older V1 empty databases remain readable without
rewriting them. A pandas column projection
also includes any physical index columns needed to reconstruct the original
index. The reader assembles Arrow columns before converting the complete
selected table to pandas, preserving extension dtypes and categorical/index
metadata. Read performance claims must distinguish a full read, a column
projection, and a tail read.

Each block has compressed and uncompressed SHA-256 checksums. A root manifest
binds schema, total row count, block positions, row counts, and checksums.
Verification separately checks SQLite structural integrity, every block, the
exact Arrow schema, and the ordered source data. A partial read verifies its
manifest and selected blocks; only full verification establishes that every
unselected block is also readable.

## Structured documents and event streams

`app/core/object_sqlite.py` stores JSON-compatible values with
explicit format and document-kind identifiers. Settings and ordinary documents
retain the complete parsed value, including nested fields, strings, integers,
booleans, nulls, arrays, and financial values represented as strings. Invalid
or unsupported values remain explicit errors.

Ordered event stores retain one occurrence per ordinal. Repeated events stay
repeated, and appends do not deduplicate or reorder earlier records. The
canonical document representation and root/block checksums provide logical
equality checks independent of whitespace in a legacy JSON or JSONL file.
Original lexical formatting and source-container details remain in the
unchanged rollback originals.

The investment ledger continues to use its specialized ordered transaction
blocks, full metadata sections, and source manifests. The separate credit-card
ledger remains separate after conversion; changing its container never moves
card liability or rewards into investment cash or P&L.

## Transactions, locks, and corruption

Read-only SQLite connections use URI `mode=ro`, so a read cannot create a
missing database. Writers use rollback-journal DELETE mode,
`synchronous=FULL`, and `BEGIN IMMEDIATE`. Existing incompatible databases are
rejected without changing their journal mode. Frame snapshot writes update
only changed blocks and remove stale blocks in the same transaction. A failed
transaction leaves the preceding committed snapshot available.

Application locks continue to protect multi-step read/modify/write operations,
source-evidence materialization, persisted readback, revision checking, and
cache publication. SQLite's own single-writer transaction does not replace an
application lock around those larger operations. A committed default database
remains authoritative; corruption never selects a historical fallback.

Investment transaction cache schema `investment-transactions-v19` also binds
the private investment-evidence store's path, existence, byte size, and
`mtime_ns`, alongside ledger and market-store fingerprints. Missing auxiliary
dependency metadata invalidates an older cache; creating, changing, removing,
or relocating that evidence requires a fresh projection. The
[investment cache contract](INVESTMENT_SQLITE.md#derived-cache-dependencies)
owns the detailed capture and publication rules.

New databases are prepared and verified before atomic, non-overwriting
publication. Files are private (`0600` on POSIX), and publication synchronizes
the file and the containing directory where the platform supports it.

## Explicit migration and acceptance

The operator entrypoint is `scripts/migrate_local_sqlite.py`. Supported options
are `--market-root`, `--settings-root`, `--compute-root`, `--apply`,
`--benchmark-runs`, and required `--report`. Without `--apply`, it validates
isolated candidates and reports the result without publishing target databases.
The investment ledger's specialized migration remains available through its
[separate tool](INVESTMENT_SQLITE.md#explicit-migration).

```bash
python3 scripts/migrate_local_sqlite.py \
  --market-root /path/to/market_store \
  --settings-root /path/to/settings_store \
  --compute-root /path/to/compute \
  --benchmark-runs 7 \
  --report /path/outside-the-stores/local-sqlite-preview.json
```

Add `--apply` only for the explicit publication run. The report path must be
outside the protected source roots and must not overwrite an earlier report.
The migration checks a conservative peak-disk budget before creating bounded
candidates. It refuses ambiguous source-to-target collisions, changes to
source signatures, and conflicting existing targets. Already-published targets
must verify against their source before being accepted on a rerun. An active
legacy compute worker must finish before its state is migrated.

For every database, acceptance covers exact schema metadata where applicable,
all ordered values or events, source SHA-256 and identity before and after
conversion, SQLite integrity, and persisted readback. A converted market file
retains the original source modification time: conversion time is not new
market data and must not make stale bars appear freshly downloaded.

Publication is atomic per database, not one transaction across all source
roots. A later failure can leave earlier verified targets published while all
original sources remain intact. Preserve that state, inspect the failure and
existing targets, and resume only through verification; do not delete a valid
target or replace it with an older original merely to restart the batch.

After full acceptance, archive legacy originals as a separate controlled
step. Keep market, settings, and compute roots separate inside the rollback
archive, with their relative paths and exact source hashes. Recheck source and
target identity before moving each original, and retain an inventory receipt.
The migration CLI itself does not archive or delete source files. Archives
are recovery evidence and are never searched as automatic runtime fallbacks.

Before claiming completion, verify the running application's intended SQLite
paths, relevant API/rendered results, and affected market, investment,
settings, and compute boundaries. A successful file conversion or a bound
server port alone is not runtime adoption. Respect manual launch ownership and
stop any agent-owned verification service before handoff.

The separate
[investment input-ablation audit](INVESTMENT_SQLITE.md#source-preserving-input-ablation)
runs cold GET scenarios against disposable copies to test legacy-file,
cache, and private-evidence dependence. It never restores missing canonical
data from an archived source. Missing investment SQLite with an adjacent
legacy ledger is an explicit API failure, while a truly empty store remains
empty. Input non-dependence is not broker-source validation or permission to
discard retained originals.

## Storage, performance, and rollback evidence

Reports distinguish logical file bytes, allocated bytes when available,
active SQLite databases, retained originals, and temporary candidates. Moving
an original into a rollback archive does not free its bytes. Per-file size
changes do not prove APFS container free-space recovery, copy-on-write
allocation, or cloud synchronization completion.

The local migration benchmark reports warm-cache full-frame and projected
column reads on selected real-source copies, with an untimed warmup and an
explicit repetition count. It does not establish cold-start performance,
write latency, whole-import latency, training throughput, or universal SQLite
speedups. Any additional write or tail benchmarks require their own measured
commands and workload definitions. Financial write benchmarks must never
modify production records.

Once a SQLite store accepts newer writes, its original becomes a historical
snapshot. A rollback must preserve and reconcile the newest committed values
before changing active readers; silently switching to an archived original
would omit those writes. Keep dated measurements, private inventories, exact
commands, and acceptance results in the local report rather than versioned
documentation.
