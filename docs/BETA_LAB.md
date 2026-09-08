# Beta research laboratory

Documentation version: `v1.0.0`
Code version: `v0.1.0`

Beta is an experimental, removable workspace in the Dock immediately before
Settings. It extends the existing shell, navigation, disclosures, controls,
and chart library. It does not register strategies or join training jobs.

## Experiments

| Route | Purpose | Current implementation |
| --- | --- | --- |
| `/beta/regime-radar` | Describe the current market texture | Trailing trend, volatility rank, drawdown, and a rebased price chart |
| `/beta/analog-explorer` | Find earlier paths resembling the latest window | Up to five disjoint 20-close shapes with fully observed 20-session continuations |
| `/beta/stress-lab` | Inspect adverse historical windows and explicit shocks | Worst 5/20/60-session returns, peak-to-trough drawdown, and an unlevered one-step shock calculator |
| `/beta/robustness-lab` | Expose sensitivity to starting date | Historical rolling holding returns and dependent-window outcome frequencies |
| `/beta/thesis-lab` | Turn a hypothesis into a falsifiable protocol | Browser-local notes and a Proponent/Skeptic/Experimenter Markdown research brief |
| `/beta/research-frontier` | Develop a sourced research direction | Curated primary sources, proposed experiments, and links that seed an unsaved thesis |

`/beta` opens Regime Radar. Feature metadata lives in
`app/beta/registry.py`; the route whitelist is derived from that registry.
Unknown experiment routes return 404.

## Isolation and removal

`app/web/routes_entry.py` has one registration hook for `app.beta`.
Set `WORTHWARD_BETA_ENABLED=0` before a normal manual launch to remove the
Beta routes and Dock entry. No settings file or persisted strategy registry
is changed. The experiment package loads its analysis implementation only
when enabled. New experiment identifiers and analyzers must remain inside
this module; the core runtime does not dispatch Beta calculations.

The Beta page builds a small presentation context from public configuration
and reuses the existing application shell. Its stylesheet and JavaScript
load only on Beta routes. CSS selectors are scoped to the Beta workspace;
chart options are instance-local. Existing Dock destinations are identified
by `data-dock-group`, so inserting or removing a module cannot shift the
Settings destination.

The four history experiments use only the GET endpoint
`/beta/api/analyze?experiment=<id>&ticker=<symbol>`. It opens an existing daily
Parquet file in read-only mode, reads Date and Close, and performs bounded
in-memory calculations. It does not call a market refresh, broker transport,
investment API, strategy registry, trainer, background worker, or filesystem
mutation. Each analysis examines at most 2,500 recent observations. Source
files are limited to 32 MiB and 100,000 rows; there are no new dependencies.

The minimum is 80 closes, or 120 for Analog Explorer. Missing caches, invalid
prices, duplicate or unordered dates, future dates, unsupported symbols, and
oversized files produce explicit errors. The response carries its source,
observation count, and latest cached date. No source repair or download is
attempted. Existing cache values may be stale and corporate actions are not
independently revalidated; these are stored-Close price diagnostics, excluding
dividend reinvestment and fees.

Pending requests have visible progress and cancellation. Editing the ticker
invalidates old results. A generation token prevents late responses from
repopulating a canceled or superseded result. Leaving the page aborts its
request and destroys its chart.

Thesis Lab writes only `worthward:beta:v1:thesis` in browser localStorage after
an explicit Save draft action. The ticker preference uses
`worthward:beta:v1:ticker` in sessionStorage. Beta theme and sidebar overrides
use their own `worthward:beta:v1:` keys, initially inheriting the existing
shell preferences. Beta does not write the core navigation memory or expose
the global language-setting mutation. Delete saved draft removes only
the thesis key. A Frontier URL seeds an unsaved hypothesis without replacing
an existing saved draft. Storage and clipboard failures remain explicit;
Markdown download is user initiated. No model is contacted or claimed to have
run, and no reminder is scheduled by entering a review date.

## Numerical interpretation

- Regime labels describe agreement between trailing indicators. They are not
  fitted hidden states, calibrated probabilities, or trading signals.
- Analog distance is RMS separation of log-price paths rebased at their
  first close. Selection uses shape only. Every candidate's full continuation
  ends before the query begins, and selected shape-and-continuation intervals
  do not overlap. A continuation is an observed historical outcome.
- Stress minima are retrospectively selected historical windows; a minimum
  can be positive in a rising sample. The shock calculator combines a user
  shock with unlevered exposure and flat residual cash. Its recovery arithmetic
  is conditional on the hypothetical loss, with no finite recovery from a
  total loss without new capital.
- Robustness windows overlap. Negative-window share is a descriptive sample
  frequency, not an independent probability estimate or strategy-validation
  result. No backtest-overfitting probability is estimated.

## Research sources

Reviewed on 7 Sep 2026. These sources inspire experiments; the initial Beta
implementation does not reproduce their trained models or claimed results.

- [KASPER](https://arxiv.org/abs/2507.18983): interpretable market regimes.
- [STUMPY pattern matching](https://stumpy.readthedocs.io/en/stable/Tutorial_Pattern_Matching.html): time-series retrieval.
- [Financial Wind Tunnel](https://arxiv.org/abs/2503.17909): retrieval-augmented market simulation.
- [FinCom](https://arxiv.org/abs/2606.00939): structured dissent in financial multi-agent deliberation.
- [Microsoft RD-Agent](https://github.com/microsoft/RD-Agent): structured research and development workflows.
- [The Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf): selection and validation risk.
- [DoWhy refutation](https://www.pywhy.org/dowhy/v0.14/user_guide/refuting_causal_estimates/index.html): challenges to causal claims.

## Verification

The focused contracts are `tests/test_beta.py`, `tests/test_beta_shell.py`,
`tests/test_beta_frontend.mjs`, `tests/test_beta_notebook.mjs`, and
`tests/e2e/beta.spec.mjs`. Python fixtures use temporary Parquet files;
browser tests use the existing isolated runtime on port 8699. Tests must
never create research or investment records in production stores.

Run focused Python and Node tests first, then the isolated browser wrapper
and the full repository gate described in [Testing](TESTING.md). An earlier
or concurrent gate result is not evidence for a later source revision.
