# Beta research laboratory

Documentation version: `v1.1.1`
Code version: `v0.2.0`

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
| `/beta/path-remix` | Separate the destination from the journey | Original, reversed, ascending, and descending orders of up to 252 observed daily returns |
| `/beta/recovery-clock` | Measure the time spent below a previous peak | Peak, trough, and recovery episodes across the bounded history, with unfinished recoveries identified separately |
| `/beta/calibration-lab` | Check whether a past-only interval covers the next observation | Prior-60-return 10th/90th quantile bands evaluated against the next daily return |
| `/beta/thesis-lab` | Turn a hypothesis into a falsifiable protocol | Browser-local notes and a Proponent/Skeptic/Experimenter Markdown research brief |
| `/beta/research-frontier` | Develop a sourced research direction | Curated primary sources, proposed experiments, and links that seed an unsaved thesis |

`/beta` opens Regime Radar. Feature metadata lives in
`app/beta/registry.py`; the route whitelist is derived from that registry.
Unknown experiment routes return 404.

The nine experiments include seven history diagnostics. Each history page
uses the shared Process List and native Collapse components to guide the
user through running an experiment, reading its mechanism, and challenging
its conclusion. The first step opens with the cached-ticker form. The guide
adapts the AgenticContext Tunnel onboarding structure while preserving the
existing Beta scroll owner, theme, controls, and typography. It does not add
another shared component implementation.

Research Frontier presents all eight directions in the same shared Process
List, with continuous numbered markers and native Collapse sections for the
next experiment and its sources and boundaries. Experiment sections start
open; source sections start closed. Source links and thesis actions reuse
standard secondary buttons and the shared wrapping action group. Frontier
does not define separate card, marker, connector, or disclosure styles.

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

The seven history experiments use only the GET endpoint
`/beta/api/analyze?experiment=<id>&ticker=<symbol>`. It opens an existing daily
Parquet file in read-only mode, reads Date and Close, and performs bounded
in-memory calculations. It does not call a market refresh, broker transport,
investment API, strategy registry, trainer, background worker, or filesystem
mutation. Each analysis examines at most 2,500 recent observations. Source
files are limited to 32 MiB and 100,000 rows; there are no new dependencies.

The minimum is 80 closes, or 120 for Analog Explorer and Calibration Lab.
Missing caches, invalid prices, duplicate or unordered dates, future dates,
unsupported symbols, and oversized files produce explicit errors. The response carries its source,
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
the thesis key. A Frontier URL or an experiment result link seeds an unsaved
hypothesis without replacing an existing saved draft. The result link carries
the observed experiment context into the existing notebook; it does not save
the hypothesis automatically. Storage and clipboard failures remain explicit;
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
- Path Remix uses the last available 252 daily returns, or fewer when
  the bounded cache is shorter. Reversing or sorting the same returns leaves
  their compounded terminal return unchanged within numerical precision,
  while the path and maximum drawdown can change. Reordered paths are
  hypothetical in-memory illustrations, not additional historical records,
  independent scenarios, probability estimates, or forecasts.
- Recovery Clock identifies drawdown episodes from running peaks in the full
  bounded sample and measures durations in observed trading sessions. An
  episode ends when Close regains or exceeds its peak. An unfinished episode
  is right-censored: its elapsed time is known, but its recovery duration is
  not. It is excluded from completed-recovery duration summaries. The first
  cached close is the initial reference peak; earlier peaks and recoveries
  outside the cached sample are unknown. The table includes the five most
  recent and five deepest episodes plus the longest completed recovery,
  with duplicates removed and at most 11 rows. Ties for the longest completed
  duration select the most recent episode.
- Calibration Lab uses prequential evaluation: each next-day simple return
  is compared with the 10th and 90th percentiles of the preceding 60 returns.
  The outcome being evaluated is never included in its own band. Observed
  coverage and misses describe this rolling historical baseline. The central
  80% quantile band is not a conformal interval, a calibrated forecast, or a
  finite-sample coverage guarantee; adjacent evaluation windows are dependent.

## Research sources

The original sources below were reviewed on 7 Sep 2026. These sources inspire
experiments; Beta does not reproduce their trained models or claimed results.

- [KASPER](https://arxiv.org/abs/2507.18983): interpretable market regimes.
- [STUMPY pattern matching](https://stumpy.readthedocs.io/en/stable/Tutorial_Pattern_Matching.html): time-series retrieval.
- [Financial Wind Tunnel](https://arxiv.org/abs/2503.17909): retrieval-augmented market simulation.
- [FinCom](https://arxiv.org/abs/2606.00939): structured dissent in financial multi-agent deliberation.
- [Microsoft RD-Agent](https://github.com/microsoft/RD-Agent): structured research and development workflows.
- [The Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf): selection and validation risk.
- [DoWhy refutation](https://www.pywhy.org/dowhy/v0.14/user_guide/refuting_causal_estimates/index.html): challenges to causal claims.

The following directions were reviewed on 30 Sep 2026:

- [Adaptive Conformal Inference for Multi-Step Ahead Time-Series Forecasting Online](https://arxiv.org/abs/2409.14792)
  and [Skew-adaptive conformal prediction](https://arxiv.org/abs/2605.16145)
  motivate testing interval coverage and asymmetric uncertainty. Calibration
  Lab supplies a transparent past-only quantile baseline; it does not implement
  either paper's conformal method or inherit its guarantees.
- [Drawdown: From Practice to Theory and Back Again](https://arxiv.org/abs/1404.7493)
  motivates investigating path-dependent risk. Path Remix and Recovery Clock
  separate return order, drawdown depth, and time below a peak; they do not
  estimate the paper's Conditional Expected Drawdown measure.

## Verification

The focused contracts are `tests/python/web/test_beta.py`, `tests/python/web/test_beta_shell.py`,
`tests/js/workspaces/test_beta_frontend.mjs`, `tests/js/workspaces/test_beta_notebook.mjs`, and
`tests/e2e/workspaces/beta.spec.mjs`. Python fixtures use temporary Parquet files;
browser tests use the existing isolated runtime on port 8699. Tests must
never create research or investment records in production stores.

Run focused Python and Node tests first, then the isolated browser wrapper
and the full repository gate described in [Testing](TESTING.md). An earlier
or concurrent gate result is not evidence for a later source revision.
