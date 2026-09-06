# Offline LSTM probability tuning

Documentation version: v1.2.0

Runner version: v0.11.0. Model version: `lstm-price-field-model/v1.2.0`.
Exact-configuration web training remains separate.
All GA objectives now rank multi-seed finalists by validation fitness; the legacy
direction mode no longer ranks or rejects finalists using holdout results.

## Causal target normalization

Each forecast origin fits feature and target transforms only on its observable
training examples. Target normalization subtracts the training-label mean and
divides by its sample standard deviation, floored at 0.0001. Both NumPy and Torch
train on these unit-scale labels. Inference restores executable log-return units
for the predicted mean and standard deviation before the shared Price Field
projection. This corrects the unit-scale Gaussian head's mismatch with small
raw returns; it does not change the target to future close returns.

Training windows use a strided array view instead of a Python loop per example.
The existing chronology, minimum of 16 usable sequences, and exclusion of factor
columns with missing observations remain enforced. Future-label mutation and
affine-target tests cover causal normalization; scalar-reference comparisons
cover window selection with missing targets and features. The model version
invalidates old fingerprints. Earlier tuned settings can be reevaluated, but
their old scores and weights do not establish performance under this model.

## Complete price-grid objective

Use `--objective grid` to evaluate the displayed close-anchored price projection
against `Close[t+h] / Close[t]` at all horizons from 1 through 20 trading days.
The underlying LSTM still trains executable next-open returns. Scoring the price
projection does not turn it into a separately trained close-return model, and
the displayed marginal probabilities are not a joint path-hit probability.

For each origin, freeze 20 equal price bands around its observed close. The
half-width is four times the causal 60-return sample volatility times the square
root of 20, bounded to 90% of the anchor price; the volatility floor is 0.5%.
Use at least 16 closes. These research bands are independent of every candidate
and of viewport size. Browser columns may span more than one day, so this is a
fixed daily research lattice, not a screenshot-dependent pixel score.

The same AR(1) moment transition used by the renderer supplies each horizon's
Gaussian price-band masses. Include all 20 bands and both outside tails, with no
display threshold, clipped-tail renormalization, or dropped misses. Half the
multiclass Brier sum has range zero through one. Missing predictions receive
loss one. Average eligible origin losses within each horizon, then give each of
the 20 horizons and each validation fold equal weight. Fitness is 100 times one
minus that loss; it is a score, not a hit-rate percentage. Report realized-cell
probability, top-cell hit rate, log score, outside-tail frequency, coverage, and
sample counts by horizon. Also report Brier skill against a zero-drift random
walk using the same causal volatility, origins, and bins.

Both origin and realized close must be inside a fold. Every fold requires all
20 horizons, at least 100 eligible origin/horizon pairs, and 80% forecast
coverage. Adjacent pairs overlap and are not independent samples. Short data
windows can leave only one or two eligible origins at the longest horizon;
report that uncertainty rather than treating 400 cells as 400 independent trials.

Grid search and robust selection physically truncate model and factor inputs
before the holdout. Freeze `selection.json` before evaluating the selected three
seeds and the original seed-42 baseline on the final 20%. A holdout failure does
not promote a runner-up. No feasible finalist or incomplete holdout reporting
produces an explicit failure instead of a completed winner. Historical holdouts
that have already been inspected remain retrospective evidence.

The multiclass quadratic scoring rule follows
[Gneiting and Raftery (2007)](https://sites.stat.washington.edu/people/raftery/Research/PDF/Gneiting2007jasa.pdf).
The causal bins, fold weighting, and missing-prediction penalty are this
repository's research protocol.

## Objective and chronology

Use `--objective probability` for the existing one-step objective. The page metric is 100 times one minus mean Brier
loss, where the outcome is the sign of `Open[t+2] / Open[t+1] - 1`. An always-0.5
forecast scores 75, so the displayed percentage is not directional accuracy.

The GA uses three chronological validation windows spanning the middle 60% of
observations. It removes each window's final two origins so the executable target
does not cross the next boundary. The first 20% supplies initial history; the
final 20% is excluded from candidate ranking, feasibility, tie-breaking, and
multi-seed winner selection. Walk-forward training may incorporate earlier
observations once they are available, including earlier holdout observations.
This measures sequential retraining, not a frozen-weight model.

Each validation window requires at least 15 eligible targets and 80% prediction
coverage. Every eligible target has the same denominator across candidates.
Missing predictions receive loss 1; valid predictions receive squared probability
error. Neutral 0.5 forecasts remain eligible. Maximize the target-count-weighted
mean of these penalized window scores. This differs deliberately from the page's
valid-predictions-only metric; report both instead of comparing their percentages
as if they were identical. Coverage is a separate minimum eligibility guard.

Rescore the top eight distinct configurations with seeds 42, 43, and 44. Rank
complete, feasible seed groups by mean validation fitness. Report holdout Brier
score, probability score, coverage, sample size, and seed dispersion after the
choice is fixed. Holdout metrics never select the winner. A historically inspected
holdout is not new prospective evidence; repeated research on the same window
still risks overfitting. Compare with the original configuration and the 75-point
constant-probability reference on the same origins.

Direction reporting also includes the always-up hit rate, balanced accuracy
(the mean of upward and downward recall), and hit rate over all finite nonzero
targets. Missing and neutral forecasts count as misses in the latter two model
metrics. Balanced accuracy is unavailable when either direction is absent.
Keep the original conditional hit rate and coverage visible: selecting only a
few confident forecasts must not look equivalent to predicting every target.

## Search and local execution

Use population 32 and explicitly size the spawn pool from local measurements.
For tiny origin-local networks, NumPy CPU can substantially outperform MPS;
kernel launch and graph compilation can dominate GPU arithmetic. Retain four elites,
tournament selection, uniform crossover, and 10% mutation, increasing to 20%
after 20 stagnant generations. Search training window 30 through the available
row count (capped at 504), chip window 5 through available rows (capped at 252),
lookback 4–16, hidden size 4–32, epochs 1–20, and learning rate 0.001–0.5.
Only factors with sufficient real observations in the snapshot are searchable.
The base configuration seeds the population; it does not freeze factor switches.
`cell_display_threshold` stays fixed and never enters fitness.

Use a new external `--state-root`, `--offline`, `--snapshot-file`, and an explicit
base compute backend. The snapshot must be genuine local data for the requested
ticker and interval. Its dates override the relative period. The request hashes
the source snapshot; the run then owns a separate frozen copy. The original
snapshot, market store, and broker stores remain unchanged.

Set `WORTHWARD_REMOTE_MARKET_ACCESS=disabled` and run under an OS network-denial
sandbox for a strict offline boundary. There are no LLM calls in the search.
MPS is the GPU compute backend; Neural Engine execution is not claimed. Keep the
machine on power and use `caffeinate -i` during the job.

`--rescore-backends CPU GPU` expands each of the top eight configurations into
three seeds per backend. With a CPU search base, CPU evaluations reuse the main
pool while GPU evaluations use one separate spawn worker. Backend is part of
model identity: the resulting 16 three-seed groups are independently trained,
and validation scores select both configuration and backend before holdout
inference. This is a CPU-led hyperparameter search followed by GPU validation,
not an exhaustive independent GPU hyperparameter search. Omitting the option
retains the base backend alone. GPU failures cannot count as confirmed GPU
evidence; inspect the actual engine and fallback fields in every result.

The local accelerator mechanism follows Apple's
[PyTorch Metal backend](https://developer.apple.com/metal/pytorch/) and PyTorch's
[MPS backend documentation](https://docs.pytorch.org/docs/stable/notes/mps.html).
Backend availability alone is insufficient; require a real tensor readback and
record the actual training device. Cold and warm MPS timings must be distinguished.

## Ten-hour wall-clock budget

The runner's `--duration-seconds 35400` leaves ten minutes inside a 36,000-second
outer budget for startup and shutdown. It reserves its final 15 minutes for
multi-seed scoring. A supervisor must start its monotonic timer before launching
and enforce the outer limit: send SIGTERM to the owned process group at 35,940
seconds and SIGKILL at 36,000 seconds if it has not exited. Never target an
existing app or another compute job. This hard deadline is supervisor policy;
the runner alone has a soft deadline because in-flight workers can finish after
its scheduling budget. `scripts/lstm_ga_supervise.py` v1.0.0 implements this
policy with `--budget-seconds 36000 --metadata <new-path> -- <runner-command>`.
Its deadline includes startup and sends the hard-stop signal at the budget;
process reaping and metadata flush can finish shortly afterward. It owns a new
process group and a PID-bound `caffeinate`, and never restarts interrupted work.
The runner polls blocked futures so a hung worker cannot hide the deadline.
Do not claim a strict ten-hour limit from the runner CLI alone.

Checkpoint, request, snapshot, status, evaluations, and leaderboard files remain
outside production stores. Resume only explicitly; do not automatically restart
an interrupted job. `result.json` with completed status is required for a final
winner. Budget exhaustion or incomplete rescore is an incomplete run, even if a
provisional leaderboard exists. Return a reproducible winner URL with its actual
seed and frozen date range only after successful completion.

## Six-hour single-stock research protocol

The 6 Sep 2026 NVDA experiment uses 753 visible daily observations from
6 Sep 2023 through 4 Sep 2026, plus 130 earlier warmup observations. Longbridge
forward-adjusted daily OHLCV supplies the immutable input. Only volume and
volume-at-price are searchable external features because the snapshot contains
no authoritative historical options or fundamental observations. The final 20%
begins on 30 Jan 2026. Earlier NVDA research has already inspected related
historical periods; this holdout remains retrospective evidence.

On the measured Apple M1 Max with 32 GiB of unified memory, this run uses a
four-worker CPU search and a one-worker MPS finalist pool. The supervisor budget
is 21,600 seconds. The runner budget is 21,000 seconds with
`--final-reserve-seconds 7200`, leaving roughly three hours and 50 minutes for
search, two hours for multi-seed validation and holdout reporting, and ten
minutes of outer shutdown margin. The reserve is a scheduling allowance, not a
guarantee that every finalist will complete. `result.json` remains mandatory.
The source tree, input, parameters, random seed, hardware, and launch command
are frozen outside the repository; network access and repository writes are
denied for the research process. The running web application is not restarted.

A fixed-parameter development comparison used only early observations, before
the experiment's final holdout. It produced the following grid scores on common
origins. These are probability scores, not directional hit rates.

| Backend | Model v1.1.0 grid score | Model v1.2.0 grid score | v1.2.0 random-walk Brier skill |
| --- | ---: | ---: | ---: |
| NumPy CPU | 58.13794 | 59.15007 | 0.00602 |
| Torch MPS | 51.67047 | 59.20184 | 0.00728 |

For the 149 nonflat development direction targets, MPS directional accuracy
rose from 48.32% to 57.05%; always-up achieved 56.38%, and the new model's
balanced accuracy was 54.08%. New MPS one-step Brier loss was 0.25012, slightly
worse than the constant-0.5 reference's 0.25. These small, single-seed historical
results support testing the scale correction, not claiming predictive alpha.

CPU completed the benchmark in about 2.65 seconds. Initial MPS order
(old, new) took 37.68 and 24.72 seconds; reversing the order took 32.84 seconds
for new and 25.03 for old. Scores reproduced, but the timings reveal a large
cold/warm effect. No MPS speedup percentage is attributed to the code change.
A separate real mixed-pool smoke test completed three seeds on each backend,
with two feasible groups, confirmed MPS execution, and no runtime fallback.
This does not resolve the previously observed web-process Metal abort.

The changed runner, compute, strategy, scoring, and training suites passed
103 tests and two subtest checks on 6 Sep 2026. The durable research run's
checkpoint and leaderboard are progress evidence; its final winner and holdout
comparison require successful completion of the supervised run.

The complete gate then exited 1: Python passed 1,187 tests with six skips and
216 subtest checks, JavaScript passed 329 tests, and Chromium passed 325 tests
with one Bayesian pan-reset failure. The failure retained a 0.0008057px visual
offset while the remaining reset fields were zero. Two unchanged focused
replays passed; this does not make the full gate green or resolve the
intermittent reset issue. Its 0.001px early-return guard is also present in the
committed pre-extraction controller. No tolerance, animation, or test behavior
was changed during this research task. The final documentation contract replay
passed 12 tests. The six-hour offline research process continued independently.

## Verification on 5 Sep 2026

Final focused runner, training-service, Price Field, layout, and repository
contracts passed 102 tests. JavaScript unit tests passed all 324 cases.
Four isolated Chromium cases passed at 1,138px and 390px in light and dark modes,
checking blue token equality in both disclosure states and keyboard interaction.
Private snapshot reproduction and full-gate evidence are kept in local task
artifacts, not this public contract.

The complete gate stopped in Python with 1,159 passes, six skips, 195 subtest
passes, and two stale stylesheet cache-key failures. Both failures were repaired
and passed in the final focused run. The complete gate was not rerun to completion;
no full-gate success is claimed.

## Grid verification on 6 Sep 2026

Focused grid-scoring, supervisor, GA, compute, strategy, and training-service
checks passed 98 tests with two skips and two subtest passes. The real local
MPS smoke run completed 28 generations, 83 evaluations, eight robust groups,
and three selected holdout seed reports. Its supervisor exited successfully
after 458.060 seconds, within the configured 660-second outer limit.

The complete `./scripts/check.sh` exited 1: Python passed 1,181 tests with six
skips and 216 subtest passes; JavaScript passed all 324 cases; Chromium passed
319 cases and failed four QQQ three-year LSTM navigations in the disclosure
layout suite. Those failures exceeded the 30-second navigation timeout before
layout assertions, while separate MPS research work was active. The LSTM
training/history, probability-field rendering, and hover checks passed. This
is not a green gate or an isolated latency benchmark; the navigation issue
remains open. No layout tolerance or timeout was relaxed.
