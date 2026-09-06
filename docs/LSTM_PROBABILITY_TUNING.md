# Offline LSTM probability tuning

Documentation version: v1.1.0

Runner version: v0.10.0. Exact-configuration web training remains separate.
All GA objectives now rank multi-seed finalists by validation fitness; the legacy
direction mode no longer ranks or rejects finalists using holdout results.

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

## Search and local execution

Use population 32 and two spawn workers on Apple MPS. Retain four elites,
tournament selection, uniform crossover, and 10% mutation, increasing to 20%
after 20 stagnant generations. Search training window 30 through the available
row count (capped at 504), chip window 5 through available rows (capped at 252),
lookback 4–16, hidden size 4–32, epochs 1–20, and learning rate 0.001–0.5.
Only factors with sufficient real observations in the snapshot are searchable.
The base configuration seeds the population; it does not freeze factor switches.
`cell_display_threshold` stays fixed and never enters fitness.

Use a new external `--state-root`, `--offline`, `--snapshot-file`, and an explicit
GPU base parameter. The snapshot must be genuine local data for the requested
ticker and interval. Its dates override the relative period. The request hashes
the source snapshot; the run then owns a separate frozen copy. The original
snapshot, market store, and broker stores remain unchanged.

Set `WORTHWARD_REMOTE_MARKET_ACCESS=disabled` and run under an OS network-denial
sandbox for a strict offline boundary. There are no LLM calls in the search.
MPS is the GPU compute backend; Neural Engine execution is not claimed. Keep the
machine on power and use `caffeinate -i` during the job.

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
