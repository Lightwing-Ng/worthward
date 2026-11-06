# Investment SQLite ledger

Documentation version: `v1.4.0`

This document owns the investment ledger's SQLite persistence contract and
explicit migration workflow. It changes storage without changing broker import,
accounting, cash replay, transaction identity, or evidence authority. The
[Architecture guide](ARCHITECTURE.md) owns those domain invariants.

## Backend selection

`app/infrastructure/storage.py` uses
`settings_store/investment.sqlite3` as the default investment ledger.
The configured settings-store directory still owns its location.

- An existing SQLite ledger is authoritative for the default path.
- Default runtime access uses SQLite directly. A missing SQLite ledger is
  not silently reconstructed from an adjacent or archived Parquet/JSON file;
  legacy conversion is an explicit migration operation.
- An explicit `.parquet` or `.json` path retains the legacy backend and its
  compatibility behavior. These paths remain available to existing callers
  and isolated tests.
- A present but corrupt or incompatible SQLite database fails closed.
  Falling back to a retained Parquet snapshot after a SQLite error could
  conceal newer committed imports and is prohibited.

For `GET /api/investment/transactions`, a missing canonical SQLite ledger with
an adjacent `investment.parquet` or `investment.json` produces an explicit
HTTP 500 migration error. It must not appear as a successful empty account.
A genuinely empty store without those adjacent legacy files retains the
ordinary empty response. Corrupt canonical data also produces a failure;
neither case searches backups or rollback archives to reconstruct a ledger.

The separate credit-card ledger, settings, market data, and derived investment
caches also use SQLite under the [complete local persistence contract](LOCAL_SQLITE.md).
They retain their separate ownership and schemas. Broker credentials keep their
existing configuration or Keychain boundary.

## Lossless representation

The database contains one section per non-transaction payload field and
ordered blocks of at most 256 transactions. Each section is
encoded as JSON and compressed with zstd. This is a SQLite container with
compressed payload blocks; financial fields are not independently converted
into SQL numeric columns.

The persistence boundary preserves every supported nested JSON value,
metadata field, source-provenance field, transaction occurrence, and original
transaction-list position. Duplicate transactions remain duplicate
occurrences. Nulls, explicit unknowns, empty lists, numeric values, and string
values retain their existing meaning. Storage does not round amounts,
reinterpret currencies or dates, normalize broker identities, or infer
missing financial records. Unsupported or malformed payloads remain errors.

Each compressed section has a SHA-256 digest, and the manifest has a root
digest binding the complete ordered snapshot. A read verifies sections and
the manifest before returning a payload. Format/version checks reject
unsupported databases. SQLite structural integrity and logical payload
equality are separate verification boundaries; neither substitutes for the
other.

Preserving the logical payload does not mean preserving Parquet file bytes
inside SQLite. The unchanged original Parquet file remains the byte-level
pre-migration rollback artifact, including source-container metadata that is
not an application-ledger field. A verified rollback archive preserves those
bytes after the original leaves the active store directory.

## Transactions and locks

Read-only connections use SQLite URI `mode=ro`; reads do not create a missing
database. Writers use DELETE journaling, `synchronous=FULL`, and
`BEGIN IMMEDIATE`. One transaction updates metadata, changed transaction
blocks, and their manifest together. A failed write rolls back the complete
snapshot.

Snapshot writes compare block digests and use incremental UPSERT operations
only for changed blocks; blocks removed from the requested snapshot are
removed in the same transaction. Unchanged transaction blocks are not
rewritten when only metadata changes. The public API still accepts and
returns the complete payload, so encoding, hashing, and validation costs
remain part of the measured full-snapshot workload.

The existing reentrant ledger lock continues to surround import read,
merge, evidence materialization, persistence, cache invalidation, persisted
readback, and evidence verification. The default logical ledger uses its
`.sqlite3` lock consistently. An explicitly selected legacy backend keeps its
`.parquet` lock. Explicit migration and runtime operations must agree on
the logical ledger's lock; unrelated lock names cannot protect a shared
commit boundary.

## Derived cache dependencies

The derived transaction cache uses schema `investment-transactions-v19` at
`settings_store/investment_cache/transactions_payload.sqlite3`. A cache entry
binds the canonical ledger fingerprint, relevant local market-store
fingerprints, and the optional
`settings_store/private_investment_evidence.sqlite3` fingerprint. Each file
fingerprint includes its path, existence, byte size, and `mtime_ns`.

The private evidence store is an input to broker performance calibrations and
verified tax-lot annotations. Its creation, revision, removal, or path change
invalidates an existing transaction cache even if the canonical ledger has
not changed. An older cache without the private-evidence dependency cannot
count as a hit. The request captures that dependency before loading the
ledger projection and checks it again before publishing a cache; an older
projection must not be labelled with a newer auxiliary-evidence revision.

These metadata fingerprints identify ordinary file revisions. They do not
replace SQLite integrity checks, payload checksums, or broker-source
verification. A cache hit is not proof that every original broker artifact
is present or that an account-level calibration is economically correct.

## Evidence and clearing

The immutable source sidecar remains `investment_evidence/`. Deriving it from
the ledger stem gives the same directory for `investment.parquet` and
`investment.sqlite3`. Migration neither moves nor rewrites evidence, and it
preserves the complete evidence manifest in the payload. Import commit and
explicit evidence verification retain their existing SHA-256 and byte-count
requirements. Ordinary ledger reads do not require every source artifact to
be locally available.

The explicit clear operation removes the current and adjacent legacy ledger variants
under the ledger lock, together with the evidence removal already owned by
that operation. Retaining an old fallback file after clearing could restore
the supposedly removed history on a subsequent read and is prohibited.
Migration itself does not clear any ledger or evidence. Rollback archives are
separate protected recovery artifacts; clearing an active ledger does not
authorize searching or deleting unrelated archived originals.

## Explicit migration

`scripts/migrate_investment_sqlite.py` is the operator entrypoint. Its supported
options are `--source`, `--target`, `--apply`, `--benchmark-runs`, and `--report`.
The default is a dry run; publishing a target requires `--apply`.

For example, from the repository root with the supported Python runtime:

```bash
python3 scripts/migrate_investment_sqlite.py \
  --source settings_store/investment.parquet \
  --target settings_store/investment.sqlite3 \
  --benchmark-runs 7 \
  --report outputs/investment-sqlite-preview.json
```

After reviewing the dry-run report, add `--apply` to publish the verified
candidate. Keep reports outside protected source and target paths. Reports
are local acceptance evidence, not versioned financial datasets.

Migration follows these boundaries:

1. Select explicit source and target paths, acquire the runtime-compatible
   ledger lock, and record the original source-file SHA-256.
2. Decode the complete source through the existing storage contract and
   prepare a candidate without changing the source or evidence directory.
3. Read the candidate back and compare the complete logical payload and its
   digest, including all metadata, nested provenance, duplicates, and list
   order. Check SQLite integrity independently.
4. Recheck the original source SHA-256 before publication. A changed source,
   failed validation, or conflicting existing target prevents publication.
5. Publish the verified candidate without overwriting an existing target.
   Retain the original Parquet file unchanged and report both artifacts.

A successful conversion is not proof that a running process has adopted the
new backend. Runtime adoption requires the intended source code and default
path in that process, followed by persisted readback. Respect the user's
manual launch ownership; the migration tool does not replace that workflow.

## Rollback boundary

The retained Parquet file represents the exact state before migration. Before
any subsequent SQLite import, it can support a return to the explicitly
selected legacy backend. Once SQLite has accepted newer writes, the old
Parquet file is a historical snapshot. Switching to it would omit those
writes; a rollback must first preserve and reconcile the latest SQLite
payload through the normal validated storage boundary. Do not automatically
dual-write or silently select an older backend after an error.

## Storage and performance evidence

The migration report records both logical file bytes and allocated bytes.
Active-store size is reported separately from retained originals, rollback
artifacts, and temporary benchmark copies. A smaller SQLite active file does
not establish lower total retained disk use while both formats remain.
Per-file allocation is not an attribution of APFS container free space,
copy-on-write sharing, or completed cloud synchronization.

Benchmarks run only on isolated disposable copies. They use warm filesystem
cache and repeated samples; the report identifies the number of runs and
summarizes their timings. They compare equivalent complete-payload reads
and writes through the respective storage APIs. Snapshot-save timings exclude
the preceding read and payload mutation; atomic-update timings include the
locked read, mutation, and commit. Both report metadata-only and
one-transaction changes separately. Each timed write changes metadata or one
transaction copied from the actual source,
so a no-op write cannot be presented as an update speedup. No benchmark
record reaches a production store.

SQLite commit timing includes complete-payload JSON encoding, compression,
hashing, transaction work, and FULL synchronization. Incremental disk writes
do not eliminate CPU work in the full-snapshot API. Parquet remains a
compressed columnar format and may remain smaller or faster for some
workloads; gains and regressions must come from the local measurements.
Warm-cache results are not cold-start, browser rendering, remote storage,
or universal performance guarantees.

No measured storage or timing baseline is recorded in this contract. Keep
dated results and environmental details in the explicit local report, and
report whether runtime adoption and production readback were separately
verified.

## Source-preserving input ablation

Use `scripts/audit_investment_storage_ablation.py` to measure which inputs
affect the actual `GET /api/investment/transactions` response. It is an audit
of input dependence, separate from migration and broker reconciliation:

```bash
python3 scripts/audit_investment_storage_ablation.py \
  --settings-root /path/to/settings_store \
  --market-root /path/to/market_store \
  --report /path/outside-the-stores/investment-storage-ablation.json
```

The report must be a new file outside both source roots. Optional
`--scenario` selects one named control in addition to the full baseline;
the default runs the complete matrix. This command has no publication or
production-repair mode.

The audit inventories structured inputs, checks a conservative disk budget,
and prepares independent disposable copies. Each scenario starts a fresh
Python process with isolated settings, market, and compute roots, disabled
remote market and broker CLI access, and Python socket connections rejected.
Workers reject protected-source accesses at the observed reader entrypoints.
The report distinguishes
attempted opens from successful opens, records shadow-file access and
additional live threads, and checks that the GET itself did not rewrite its
prepared core inputs. Source inventories are checked again after the audit.

Reader observations cover Python `open`/`io.open`, `sqlite3.connect`, pandas
`read_parquet`, Arrow Parquet and dataset path readers, `memory_map`, and
`input_stream`. Source paths are checked before the wrapped native readers
run; unresolved custom filesystem contexts are rejected. Counts describe
observed reader/open calls, not physical opens or bytes consumed, and nested
readers can be counted more than once. Direct Arrow file classes and filesystem
methods, pre-opened handles, and arbitrary C/OS file or network I/O remain
blind spots. The audit does not provide system-call-level isolation or a proof
that no unobserved native reader ran.

The matrix compares retained legacy files, removed legacy files, conflicting
legacy files, cache presence and stale cache entries, external private
evidence, and private evidence already materialized in the canonical payload.
Missing and corrupt canonical-ledger controls retain adjacent legacy files
to verify explicit failure. Removing an external private-evidence file alone
does not establish that its earlier materializations have disappeared from
the ledger. Conservative materialized controls remove only provable,
unambiguous matches in disposable copies. Explicitly tagged calibration
controls are exploratory; they never authorize deleting production evidence.

The stable full-response fingerprint excludes only top-level cache metadata,
store version, realtime quotes, `section_freshness.target_trading_day`, and
scenario-local path prefixes. It retains transaction order, duplicates,
financial dates, amounts, provenance, account snapshots, and other response
fields. A separate selected-economic-fields digest is supplementary and
cannot replace complete-response comparison.

Opaque immutable broker `.bin` contents are neither copied nor rehashed by
this ordinary-GET audit. Isolated sparse placeholders retain their names and
sizes, and an observed GET reader/open on them rejects the scenario. Market rollback
archives and presentation-only native images are outside this ablation;
current market SQLite data is held constant. This audit therefore does not
replace the explicit source-artifact verifier or measure browser layout.

An unchanged response after legacy-file removal establishes non-dependence
for that tested path, not broker-level accounting correctness. A response
change after private-evidence ablation establishes influence, not that the
evidence is erroneous. Keep private counts, account values, exact differences,
and dated run results in the local report rather than this contract.

### Final browser accounting

Add `--browser-report /path/outside-the-stores/browser-ablation.json` to the
ablation command to send each real API response through the current Investment
page. The parent retains private, transient response transports until the
browser finishes; those transports are neither runtime stores nor production
ledger candidates. Budget for the complete responses, disposable stores, and
browser artifacts before starting. Report destinations reject protected-store
ancestors and case-insensitive aliases, and workers reject symbolic and hard
links before preparing a case.

The browser helper holds the existing host E2E lock and starts one guarded
application server on an ephemeral loopback port. It never reuses the user's
service. Every scenario receives its own browser context, the same fixed
browser Date, and the same source-backed market, FX, quote, session, and
intraday responses. Auxiliary responses are captured from the isolated baseline
and replayed; missing intraday observations remain gaps or the application's
normal fallback. Later scenarios cannot silently introduce new auxiliary data.
Backend workers retain their recorded wall clocks and must agree on the target
trading day; this is not a claim that the entire Python process clock is frozen.

Observation hooks are inserted only into served response copies, without
changing application source or accounting return values. Acceptance compares
rendered Holdings, aggregate and broker metrics, ticker summaries, current
chart P&L, and every captured historical curve point. A repeated real data load
and render must reproduce those results. Canonical-ledger failure controls must
render an explicit error. Preserve numeric values and unavailable/coverage
states; rounded DOM text or an equal final chart endpoint is insufficient.

The optional browser report is separate from the API report. API payload
equality, complete transaction equality, browser accounting equality, and
native broker reconciliation are distinct checks. A dormant disk backup can
be irrelevant while an earlier materialized calibration still affects P&L.

Browser runs retain a private durable workspace, defaulting to a new
`<browser-report>.workspace` directory. Use `--browser-workspace` to select
another new directory outside protected stores. The API report is published
before browser execution. Complete response transports are compressed in
SQLite, verified after publication, and removed from disposable case folders.
APFS copies use separate copy-on-write files when supported; hard links remain
prohibited. Space checks also run between stages.

Each actual browser capture, its repeated-render comparison, all curve values,
and its access audit are compressed and committed immediately to a SQLite
checkpoint with FULL synchronization. Compression is checked by complete
round-trip SHA-256 comparison. The final JSON is a compact index into this
durable evidence; retain its referenced database. Resuming requires the same
independently recorded complete input identity, application source, clock,
timezone, auxiliary responses, and controls. Failed or incomplete financial
captures are preserved and cannot silently become successful on retry.

Exact-input reuse is recorded explicitly. It requires the complete response
bytes and HTTP status to match, rather than only an economic projection or
transport-filtered fingerprint. The baseline, old-file removal, and conflicting
legacy-file controls still render independently. Inputs that change calibration
data are evaluated separately. Report actual browser renders, reused identical
inputs, and backend scenarios as separate counts; reuse is not another browser
execution.

### Original broker evidence

`scripts/audit_manual_calibration_evidence.py` produces a read-only per-scope
linkage audit from an explicitly selected ledger and private-evidence store.
Native source discovery must include the operator's original broker archive,
not only `source_artifacts` or the managed evidence sidecar. A missing manifest
link does not establish that the original file is absent elsewhere.

For each original observation, preserve its complete file checksum and length,
account identity, broker, ticker, currency, row or page, measure, and coverage
period. An execution export can establish a trade without proving cumulative
realized P&L. Matching amounts, a private mapping, filenames, or a materialized
copy do not independently establish an account alias or complete tax-lot
coverage. Use separate source-backed, conflicting, and insufficient verdicts;
an ablation effect alone does not select any of those verdicts.
