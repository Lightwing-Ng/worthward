# Neural Price Field research

Documentation version: `v1.4.0`

## Scope and model evidence

Eight additional daily strategies share the existing Price Field controls,
Market factors, training history, and probability renderer. Existing Bayesian
and LSTM strategies remain independently selectable. These are compact,
from-scratch adaptations of published forecasting architectures, not imported
pretrained models or reproductions of their published benchmark numbers.
There is no established public ranking of their trading win rates on NVDA,
MU, QQQ, or DRAM. Forecasting evidence motivates the shortlist; frozen causal
validation determines whether a local configuration improves probability quality.

| Strategy ID | Implemented core | Primary evidence |
| --- | --- | --- |
| `patchtst-price-field` | Shared patch encoder and temporal attention per variable, followed by factor fusion | [PatchTST paper](https://arxiv.org/abs/2211.14730), [author implementation](https://github.com/yuqinie98/PatchTST) |
| `tsmixer-price-field` | Residual time and feature mixing | [Google TSMixer paper](https://arxiv.org/abs/2303.06053), [author implementation](https://github.com/google-research/google-research/blob/master/tsmixer/tsmixer_basic/models/tsmixer.py) |
| `nhits-price-field` | Multirate pooling, hierarchical interpolation, and residual backcast blocks | [N-HiTS paper](https://ojs.aaai.org/index.php/AAAI/article/view/25854), [author implementation](https://github.com/Nixtla/neuralforecast/blob/main/neuralforecast/models/nhits.py) |
| `timexer-price-field` | Endogenous patches and global token with exogenous variate cross-attention | [TimeXer paper](https://arxiv.org/abs/2402.19072), [author implementation](https://github.com/thuml/Time-Series-Library/blob/main/models/TimeXer.py) |
| `itransformer-price-field` | Inverted historical variate tokens, cross-variable attention, and target-token horizon projection | [iTransformer paper](https://arxiv.org/abs/2310.06625), [author implementation](https://github.com/thuml/iTransformer/blob/main/model/iTransformer.py) |
| `tide-price-field` | Covariate projection, residual dense encoder/decoder, per-horizon temporal decoder, and linear target residual | [TiDE paper](https://arxiv.org/abs/2304.08424), [author implementation](https://github.com/google-research/google-research/blob/master/tide/models.py) |
| `moderntcn-price-field` | Large temporal depthwise convolution with separate within-variable and cross-variable pointwise mixing | [ModernTCN paper](https://openreview.net/forum?id=vpJMJerXHU), [author implementation](https://github.com/luodhhh/ModernTCN/blob/main/ModernTCN-Long-term-forecasting/models/ModernTCN.py) |
| `tft-price-field` | Conditional variable selection, gated residuals, local encoder/decoder LSTMs, and shared-value temporal attention | [TFT paper](https://arxiv.org/abs/1912.09363), [author implementation](https://github.com/google-research/google-research/blob/master/tft/libs/tft_model.py) |

The code implements these mathematical structures locally rather than vendoring
third-party source. Gaussian marginal heads, the small parameter budgets, factor
fusion, missingness treatment, and financial targets are Worthward adaptations.
TSMixer here refers to Google's architecture, not IBM PatchTSMixer. Newer
foundation models are not automatically better for this experiment: pretrained
corpus dates and overlap require a separate leakage audit, and a large generic
model is not an independently validated financial probability model.

## Second-cohort architecture boundaries

iTransformer, TiDE, ModernTCN, and TFT add complementary inductive biases; they
do not replace the first four strategies or alter an already frozen experiment.
Their input is `[batch, lookback, 2 * factors]`, containing standardized observed
values followed by observation masks. Each core emits raw
`[batch, 20, 2]` mean and log-scale values for the same direct Gaussian training
objective. Probability heads and financial targets are local adaptations, so
neither their names nor their papers establish a trading win-rate ranking.

- iTransformer embeds each variable's historical trajectory as one token and
  applies attention across variables. Masks stay associated with their variable.
  The target token predicts all horizons. The original implementation's output
  denormalization cannot be copied blindly: these cumulative return targets use
  the shared training-only target scaler, not the input variable's mean and scale.
- TiDE retains feature compression, residual dense encoding and decoding, a
  temporal decoder shared across horizons, and a linear residual from target
  history. The original architecture can consume known future covariates. This
  adapter supplies only horizon identity on the future side; future volume,
  fundamentals, options, benchmark returns, and actual prices are unavailable.
  It is a historical-covariate adaptation, not a reproduction of the original
  future-covariate benchmarks.
- ModernTCN separates temporal, feature-channel, and cross-variable mixing. With
  `F` variables, embedding width `D`, temporal kernel `K`, and expansion `r`, the
  main parameters per block scale as `F*D*K + 2*r*F*D^2 + 2*r*D*F^2`, excluding
  biases and normalization. The cross-variable term makes capacity control
  important when many factors are selected. Removing that mixing stage would
  turn the model into a different convolutional baseline. Temporal convolutions
  may inspect the whole observed lookback at an origin, but never later origins.
- TFT retains instance-dependent softmax variable selection, per-variable gated
  residual networks, local LSTM processing, and interpretable attention whose
  heads share the same value projection and are averaged. The known decoder
  inputs are horizon embeddings only. Four trainable neutral context networks
  replace absent static metadata; they are learned intercepts, not fabricated
  ticker attributes. Attention is masked against later decoder horizons. Variable
  selection weights describe the model's computation, not causal factor effects.

The original TFT predicts selected quantiles and uses quantile loss. This TFT
uses the shared Gaussian likelihood instead; it is not a quantile-TFT benchmark
reproduction. Three quantiles alone would not specify a full CDF or its tails.
The original paper includes realized-volatility forecasting for 31 stock indices
using substantially more history; that evidence does not establish NVDA return
accuracy from approximately 500 daily observations. The other three papers mainly
report forecasting-error benchmarks, not calibrated stock-trading win rates.
See [TFT's original target and evaluation protocol](https://arxiv.org/html/1912.09363v3#S6).

For small samples, capacity and factor count belong in causal validation rather
than being maximized automatically. A low-capacity
[DLinear baseline](https://arxiv.org/abs/2205.13504) remains a useful future
comparison; its existence also cautions against assuming a newer nonlinear model
must win. N-BEATS is less complementary to the existing residual N-HiTS cohort.
TSLANet's [official adaptive spectral block](https://github.com/emadeldeen24/TSLANet/blob/main/Classification/TSLANet_classification.py)
requires FFT and complex-valued operations; no local MPS certification of that
path is claimed, so it is not selected for this bounded expansion.

The referenced iTransformer and ModernTCN repositories use MIT licenses; Google's
TiDE and TFT source files carry Apache-2.0 notices. Local mathematical
reimplementations keep their provenance explicit. Vendoring any upstream code
would additionally require preserving its applicable notices and license terms.

## Ownership and causal model contract

Thin discovered modules in `strategies/algorithms/` declare identity and
architecture. `strategies/neural_price_field.py` owns the common strategy
parameters, provider boundary, result metadata, and renderer presentation.
`neural_price_field_inputs.py` owns causal feature preparation;
`neural_price_field_compute.py` owns training and direct horizon inference;
`neural_price_field_scoring.py` owns evaluation. Model-specific implementations
do not copy templates, chart lifecycle, grid geometry, training controllers, or
the market-factor catalog. The second cohort's compact encoders are isolated in
`neural_price_field_models.py` and `neural_price_field_tft.py`.

Every forecast origin `t` predicts the marginal distribution of
`log(Close[t+h] / Close[t])` separately for `h = 1..20` trading sessions.
Training origin `s` is eligible only when `s + 20 <= t`. Scaling, feature
eligibility, missing-value masks, and weights are fitted from the eligible
training history. A refit model may infer a batch of subsequent origins, but
each input sequence ends at its own origin. Those future inputs never refit the
model. Inference outputs must also be independent of which other origins share
their batch. Per-origin normalization and fixed training statistics satisfy
this boundary; inference-batch statistics or batch-wide period discovery do not.
Random state is restored after each request. Gaussian negative log
likelihood, AdamW, gradient clipping, dropout, and bounded scale heads provide
one reusable training path.

The endogenous input is the completed daily close return. The 36 shared optional
factors cover price/volume, historical research availability, options, valuation,
and market sentiment. Six additional Market context factors provide actual SPY,
QQQ, and SMH daily returns and 20-session momentum. Benchmarks join exact observed
session dates; absent dates remain unknown. Date-only external factor records are
released at the next observed trading session. Their original measurement date
is retained. This is a conservative availability convention, not an assertion
that the provider supplies exact publication timestamps or unrevised vintages.
Current-only snapshots and unsupported histories are never copied backward.
Factors without enough finite, varying training observations remain ineligible;
missingness encoding is model preprocessing, not a fabricated provider record.

The Gaussian return assumption supplies a complete marginal CDF and implies a
lognormal marginal price distribution; it is not evidence that actual returns
have Gaussian tails. The distributions are 20 marginal forecasts, not a joint
distribution over price paths. They cannot establish first-passage, stop-loss, or path-dependent
event probabilities. The existing execution engine may render compatibility
trades, but entry thresholds and trade return do not define this research's
probability objective.

## Probability score

The canonical score is `100 * (1 - mean_horizon(normalized Brier loss))`.
Each horizon evaluates the complete fixed causal grid: 20 finite price bands
and both outside tails, with normalized multiclass Brier loss equal to half
the sum of squared probability errors. Grid boundaries depend only on prices
observed at the origin. The 20 horizons receive equal weight. Missing forecasts
receive maximum loss on the same eligible slots rather than disappearing from
the denominator. Display thresholds and browser zoom do not change the score.

A score near 75 is not automatically evidence of useful prediction. The separate
next-day binary diagnostic gives an always-50% direction forecast a score of 75;
it is a different task and denominator from this complete multiclass grid.
Interpret the new grid score with its zero-drift historical-volatility reference,
Brier skill, forecast coverage, and per-horizon diagnostics. The reference uses
only past returns and square-root-of-horizon scaling; it is a transparent
baseline, not a claim of a correct market model.

The report includes Gaussian CRPS and reference CRPS, negative log predictive
density, realized-cell probability, top-cell accuracy, PIT histograms, and
central 50%, 80%, and 95% interval coverage and width. Continuous diagnostics use
valid forecasts only and say so explicitly. Direction hit rate excludes neutral
probability ties and unchanged prices. Overlapping horizons are dependent;
neither their count nor these diagnostics establish independent trials or a
confidence interval. Small held-out samples remain a material limitation.

## Training GUI and Apple Silicon execution

All eight strategies retain the `neural-price-field-v1` training payload family
and `price-field-training` action slot. Architecture identity is distinct from
the shared payload version. The existing controller discovers the slot
and uses `/api/price-field-training` with strategy-scoped history; the server
validates the family metadata.
Startup defaults use the validation-selected profiles from the AAPL neural
cohort whose result and terminal status completed internally on 8 Sep 2026. It
completed 1,104 evaluations with no failures, froze selection before holdout
reporting, and reported three seeds for each selected and prior-default profile.
The outer family supervisor nevertheless exited 1, so this is cohort evidence,
not a formally completed family suite. Every selected profile improved its own
prior-default mean holdout probability score, by 0.0295 to 0.3228 percentage
points. All eight selected profiles nevertheless remained slightly below the
causal random-walk reference on Brier skill, so these are AAPL-derived defaults,
not evidence of cross-ticker superiority.

All eight profiles use a 252-session training window, seed 42, a 60% transaction
entry threshold, and portable `Auto` compute selection. The cohort's final GPU
reporting policy was not a GA gene and therefore is not a product default. The
shared cell display threshold is 1%; it is an independent presentation-only
default and never enters model fitting, selection, or probability scoring.

| Strategy | Chip | Lookback | Hidden | Epochs | Learning rate | Refit | Weight decay | Dropout | Enabled causal factors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| PatchTST | 84 | 32 | 32 | 8 | 0.0003 | 20 | 0.001 | 0 | `illiquidity_20d`, `close_location`, `amplitude` |
| TSMixer | 63 | 16 | 16 | 8 | 0.0003 | 10 | 0.001 | 0.1 | `illiquidity_20d`, `momentum_20d`, `relative_volume_20d`, `momentum_5d`, `close_location`, `amplitude`, `intraday_return`, `overnight_gap`, `volume_change` |
| N-HiTS | 21 | 32 | 16 | 4 | 0.0003 | 20 | 0.001 | 0 | `momentum_20d`, `relative_volume_20d`, `momentum_5d`, `momentum_60d`, `amplitude`, `turnover` |
| TimeXer | 21 | 32 | 16 | 4 | 0.0003 | 10 | 0.001 | 0.1 | `illiquidity_20d`, `momentum_5d`, `turnover`, `volume` |
| iTransformer | 63 | 32 | 16 | 8 | 0.0003 | 10 | 0.001 | 0.1 | `momentum_20d`, `volatility_20d`, `amplitude`, `intraday_return`, `overnight_gap`, `volume_change` |
| TiDE | 21 | 16 | 16 | 4 | 0.001 | 10 | 0.01 | 0 | `illiquidity_20d`, `relative_volume_20d`, `volatility_20d`, `close_location`, `amplitude`, `intraday_return`, `overnight_gap`, `turnover` |
| ModernTCN | 42 | 16 | 8 | 4 | 0.0006 | 10 | 0.01 | 0 | `turnover` |
| TFT | 42 | 16 | 8 | 4 | 0.001 | 10 | 0.001 | 0 | `momentum_20d`, `volatility_20d`, `intraday_return`, `overnight_gap` |

Start snapshots the selected daily ticker, range, and exact parameters. It does
not silently mutate hyperparameters through GA. Stop is asynchronous and scoped
to the owned job. Completed records require a complete result, matching saved
configuration, and genuine measured diagnostics across all 20 horizons;
corrupted or partial result records cannot become selectable completed cases.
Interrupted work is not a winner.
Selecting history restores configuration, not cached weights. Isolated compute
state stays outside market, settings, and investment stores.

`Auto` for these models probes actual PyTorch MPS, then CUDA, then CPU.
Explicit `GPU` fails closed when acceleration cannot run. The runtime bridge can
use an installed compatible Python interpreter when the application interpreter
does not have PyTorch; Python 3.13 or newer is required without an upper minor
version cap. `WORTHWARD_TRAINING_PYTHON` can select that environment. The bridge
uses owned subprocesses and pipes, preserving progress and cancellation.
Backend metadata reports the actual device; CPU fallback is never labeled GPU.
See the [official PyTorch MPS documentation](https://docs.pytorch.org/docs/main/notes/mps.html).

Apple's Neural Engine is not used by this Torch training path. CPU workers and
one serialized MPS worker can operate concurrently without multiple processes
contending for the GPU. Process-local thread limits prevent nested BLAS/Torch
oversubscription. Hardware availability is measured rather than inferred from
an Auto label.
Every new core additionally needs actual forward, backward, and optimizer-step
checks on the selected accelerator. A generic device probe does not certify
all model operators. Accelerator verification disables implicit CPU fallback;
[PyTorch documents the MPS fallback switch](https://docs.pytorch.org/docs/2.7/mps_environment_variables.html).
The compact cores use ordinary dense, recurrent, normalization, and convolution
operators; they do not depend on CUDA-only FlashAttention or custom kernels.

The direct distribution adapter renders only trained horizons. The detail view
can inspect all 20 daily marginals. Both overview and detail columns represent
the separately learned horizons 1 through 20. The overview may use a wider
viewport-quantized slot for legibility on dense history charts, but that spatial
step never subsamples or renumbers the model horizons. The renderer does not use
AR(1) extrapolation beyond horizon 20. Target, anchor, score, semantic horizon,
and display-only spatial metadata describe these boundaries independently. The
legacy autoregressive adapters retain their existing behavior. Marginal standard
deviation is the model's concentration measure. One rendered cell's mass is not
a monotonic confidence score because the forecast mean can straddle a fixed price
band boundary and divide a narrow distribution across adjacent cells.
The direct detail view uses an anchor-centered logarithmic price scale because
the model's Gaussian quantity is log return and the implied price marginal is
lognormal. Its 20 equal log-return rows preserve positive true-price bounds and
place zero return at the middle row boundary. Cells, observed paths, and axis
ticks share that transform. The overview remains on the live chart Y scale, so
hover/detail parity means identical origins, learned horizons, model moments,
and Gaussian CDF evaluation within each surface's own bands; exact price-band
equality is neither required nor expected. These semantic parity and
near-versus-far concentration checks apply to every direct architecture,
including ModernTCN; none may opt out through a model-specific renderer or a
reduced horizon set.

## Frozen overnight experiment

`scripts/price_field_research.py` reads immutable real-input snapshots. The
formal NVDA experiment uses two years of daily observations, reserves the final
100 observations from all parameter and factor selection, and partitions the
preceding data after a common 128-session warmup into three chronological
validation folds. Targets must remain within their scored fold. Walk-forward
weights can subsequently learn from matured earlier evaluation outcomes, but
hyperparameters and scoring rules stay frozen; this is an online rolling
evaluation, not one untouched model fit for the entire report window.

GA crosses and mutates only supported training domains and prefix-eligible
factor switches. CPU and MPS candidates are tracked separately. Finalists and
defaults are replicated on MPS with seeds 42, 101, and 202 before a per-architecture
choice is frozen. A paired three-seed validation ablation then disables all
optional factors to test their combined contribution; it never changes that
frozen choice. Per-factor or per-group ablation is not part of this bounded
protocol. Only then are the NVDA holdout and QQQ, MU, and DRAM reporting
windows evaluated. Transfer means retraining the selected hyperparameters
causally on each ticker, not transferring unchanged NVDA weights. Sparse DRAM
history may yield insufficient coverage and must be labeled accordingly.

The coordinator writes protocol, factor audit, evaluations, status, checkpoint,
and frozen selection artifacts. It verifies all input hashes before and after
reporting. A fixed deadline includes search, final evaluation, and cleanup;
measured throughput reserves final-evaluation time. A task-owned supervisor
provides the outer process-group deadline. Checkpoints are inspection evidence,
not permission to resume a cancelled experiment automatically. Only complete
`result.json`, terminal `status=completed`, and successful supervisor exit prove
completion. Interim leaderboard rows are provisional and are not promoted into
strategy defaults.

This four-model protocol belongs to the first cohort. Additional architectures
require a separate frozen architecture list, code and input hashes, selection
protocol, and completion evidence. Discovering new registered strategies must
not silently enlarge an in-flight experiment. A previously inspected holdout
cannot be reclassified as fresh independent evidence for a new selection cycle;
any reuse must be identified as exploratory comparison.

The checkout's research coordinator uses protocol
`neural-probability-research/v1.1.0`. Repeated `--strategy-id` arguments select an
explicit architecture group; omission still selects the original four. The
`--cpu-only` switch uses CPU workers for search, finalist replication, and final
reporting without creating or probing a GPU worker. That mode allows an
independent second-cohort run to share the machine with an existing MPS run.
The original frozen source and its protocol `v1.0.0` remain unchanged. A new
cohort run requires its own output directory and terminal completion evidence;
these CLI capabilities alone do not prove that such a run has started or finished.

## Verification

Use the repository's selected Python environment for focused tests:

```sh
./scripts/test.sh -q tests/test_neural_price_field_compute.py tests/test_neural_price_field_runtime.py tests/test_neural_price_field_strategy.py tests/test_neural_price_field_scoring.py tests/test_price_field_research.py tests/test_price_field_training.py
./scripts/test.sh -q tests/test_neural_price_field_models.py tests/test_neural_price_field_tft.py
./scripts/check.sh
```

Focused coverage includes actual CPU model execution, future-data mutation,
training-label boundaries, score identities, factor availability, runtime
failure/cancellation, and isolated training lifecycle. The browser suite includes
`tests/e2e/neural-price-field.spec.mjs` for all four strategies, the direct grid,
responsive controls, and training state. Actual MPS smoke results are separate
runtime evidence. The complete gate is serialized and uses isolated port 8699;
it never reuses or restarts the user-owned application on port 8688.

The TFT core's focused CPU checks exercise genuine Gaussian-loss gradients and
optimizer updates, conditional normalized variable selection, missing-value
masking, causal horizon attention, inference-batch independence, and state reload.
They do not certify accelerator execution, GUI integration, or research quality.
