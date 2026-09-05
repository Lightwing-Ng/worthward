# Backtest defaults and market-factor controls

Documentation version: `v1.0.0`
Date: `5 Sep 2026`

## Behavior and ownership

Fresh Backtest pages default `Allow algorithmic stop-loss exits` and `Show trade details` to off. `config.toml`, web request fallback parsing, pending UI rendering,
and the canonical Workspace URL serializer agree. Explicit `stop_loss=1` and
`show_trade_details=1` remain supported. Toggling trade details writes an explicit
URL value, so reloading preserves the choice. This changes web Backtest defaults;
it does not redefine the low-level backtest engine's programmatic defaults.

Source versions: runtime v0.97.0, app.js v0.53.0, backtest.js v0.41.0,
workspace/url-state.js v1.6.0, and BaseStrategy v0.10.0. Application release
metadata remains v2.60.0.

The strategy-owned `group="factors"` metadata feeds the existing form builder and
`_collapse.html` macro. Both initial rendering and `/api/trade-strategy-fields`
use the same section builder. The title is `Market factors`. Empty groups are
omitted; field names, defaults, normalization, submission, and optimizer dimensions
are retained. No viewport-specific overrides or parallel collapse implementation
were introduced.

## Strategy audit

| Strategies | Market-factor controls | Consumption |
| --- | --- | --- |
| MACD, MACD Gemini | Fast, slow, and signal EMA periods | Close-price EMA crossover calculations |
| KNN, KNN Gemini | Indicator choice, short/long periods, volatility filter | Selected RSI/CCI/ROC/volume feature pair and volatility gating |
| Lorentzian, Gemini, ChatGPT | Price source, feature count, five feature definitions and their periods, volatility/regime/ADX/EMA/SMA filters | Configured feature vectors and enabled trend/volatility gates; feature count and filter switches govern conditional use |
| Supertrend AI, Gemini | ATR period and multiplier search range/step | ATR-based candidate trends; clustering and memory remain model parameters |
| Bayesian Price Field, LSTM Price Field | Existing canonical boolean factor definitions | Shared Price Field transforms, model-specific selection/training, and provider availability diagnostics |
| Buy and hold, Grid Trading, DCA, Leveraged rotation | No factor section | Their controls configure allocation, execution, schedule, or a drawdown trigger, rather than independent indicator inputs |

Only the two Price Field models consume the existing Longbridge external-factor
pipeline. Technical-indicator strategies do not advertise P/E or options toggles
that they cannot consume. No new external factor was connected to their trading
signals. Price Field retains point-in-time availability rules and unavailable or
unsupported-market diagnostics; an enabled factor is not a guarantee that causal
observations exist. LSTM's actual training action remains named `LSTM training`.

An AST comparison against HEAD confirmed that all nine technical-indicator
implementations are unchanged after removing form-group metadata and documentation.
Their numerical and trading behavior was not rewritten by this change.

## Verification

- Focused Backtest/form tests: 42 passed, 16 subtests passed.
- Additional factor provider, Supertrend, and registry schema checks: 31 passed,
  20 subtests passed.
- Full Python gate: 1,159 passed, 6 skipped, 195 subtests passed; 73.7% coverage.
- Full JavaScript gate: 324 passed.
- New isolated browser checks confirmed off defaults, explicit opt-in/reload,
  and real field sections across all 15 strategy fragments.
- In-app browser DOM inspection of isolated MACD confirmed both switches off,
  standard `ui-collapse strategy-parameter-collapse`, three real EMA inputs,
  current versioned assets, and zero horizontal page overflow.
- Full Chromium gate: 310 passed, 8 failed. Seven Backtest failures were old
  assumptions about enabled details or all fields being expanded. After adapting
  those scenarios, the final Backtest browser run passed all 34 cases, including
  actual strategy switching, edited factor submission, and reload persistence.
- The remaining full-gate issue is the pre-existing Holdings/history Market value
  alignment mismatch, outside this change. The full gate is therefore not green.
- Final JavaScript rerun after aligning missing-flag parsing: all 324 passed.
  Final Ruff, JavaScript syntax, and whitespace checks passed.

The first focused browser run exposed old tests that assumed visible equity or
Transactions on a fresh page. Scenarios that inspect those views now explicitly
enable trade details; parameter-memory tests wait for the always-visible price
chart. The new default tests independently exercise the off state.

Logs are in `/tmp/worthward-backtest-*.log`. Tests use isolated port 8699 and
runtime stores. The user-owned 8688 service was not restarted. Its cached Python
and template state must not be treated as proof of these source changes.

Final housekeeping retained ten numbered-copy candidates: six differing coverage
histories and four protected investment-cache records. Nothing was deleted.
Inventory: `/tmp/worthward-backtest-housekeeping.json`. Two newly observed,
unrelated arrowtriangle SVG assets were preserved.
