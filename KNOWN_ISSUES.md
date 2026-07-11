# Known issues and test-failure classification

Documentation version: `v1.4.0`

## Standard table and filter contract recorded on 11 Jul 2026

- Standard scrollable tables use the shared `table-controller.js`; empty, summary, and colspan rows are excluded from column measurement.
- Interactive header tables are accessible and distinct from the pointer-inert Frosted Glass visual overlay.
- Fixed summaries declare an explicit `all`, `filtered`, or `both` scope. Holdings currently use `all`; filtered tables can opt into the other scopes without changing the visual default.
- Investment History and Stock Details share an All / Buy / Sell side filter in the Type column. Broker and side filters compose before pagination.

## SF Symbols 7.2 asset audit on 11 Jul 2026

- The host Mac provides SF Symbols 7.2 and readable system symbol alias and availability metadata.
- The deprecated `waveform.and.person.filled` asset name was migrated to the canonical `waveform.and.person` name.
- Grid Trading now has a distinct grid symbol. A maintained reserve list lives beside the SVG assets in `app/web/static/images/SF_SYMBOLS.md`.

## Grid trading workspace added on 11 Jul 2026

- `/workspaces/grid-trading` is a canonical Workspace route and defaults to the `Grid Trading` strategy.
- The initial grid model uses rolling-center entry and exit bands with configurable center-line window and percentage spacing. It reuses the long-only single-position backtest engine; multi-level inventory sizing and live order placement are outside this module's current scope.

## Apple 27 design alignment recorded on 11 Jul 2026

- Liquid Glass is reserved for the functional layer: navigation, floating controls, popovers, and transient overlays. Workspace content cards and Settings action packages use standard content materials without backdrop blur.
- Sidebar symbols use a consistent monochrome weight and inherit the app accent when selected. Fixed per-section color tiles were removed; destructive cache controls retain semantic red.
- The compact bottom navigation shows both symbols and visible labels on iPhone and narrow iPad layouts. macOS and wide iPad layouts retain icon-only controls with hover tooltips.
- The web UI reuses the repository's existing SF Symbols-derived SVG assets. Producing a distributable native app icon with Icon Composer remains outside the web runtime and is not emulated with CSS.

## Classification of the 31 Python failures found on 11 Jul 2026

| Test | Classification | Resolution |
|---|---|---|
| `backtest_page_limits_intraday_period_options_to_available_history` | Outdated route and Mock | Uses canonical route and forward-compatible history stub. |
| `backtest_page_serializes_logo_profile_for_selected_ticker` | Outdated route | Uses `/workspaces/backtest`. |
| `backtest_page_uses_default_ticker_when_query_is_missing` | Outdated route | Uses `/workspaces/backtest`. |
| `hsbc_merge_prunes_stale_available_cash_before_settlement_window` | Intentional product behavior | Order rows no longer receive synthetic available-cash calibration. |
| `hsbc_pasted_import_annotates_unsettled_orders_from_available_cash` | Intentional product behavior | Cash calibration remains on cash-account rows only. |
| `ibkr_grant_merge_dedupes_conflicting_quantities_for_same_lot` | Intentional product behavior | Authoritative position snapshot reconciles the final grant quantity. |
| `longbridge_import_fetches_large_ranges_in_windows` | Intentional product behavior | Order metadata uses 60-day windows and a 30-day lookback; cash flow uses 120-day windows. |
| `longbridge_import_retries_timeout_windows_with_smaller_ranges` | Intentional product behavior | Retry assertions now start from the metadata lookback window. |
| `replay_holdings_suppresses_same_day_buy_when_positions_grant_exists` | Intentional product behavior | Raw replay reports the mismatch; snapshot reconciliation performs correction separately. |
| `investment_transactions_skips_live_refresh_for_closed_tickers` | Intentional product behavior | US broker ticker aliases are normalized to bare symbols. |
| `investment_transactions_skip_spy_proxy_for_splg_price_history` | Intentional product behavior | Failure payload uses canonical `SPLG`, never the `SPY` proxy. |
| `investment_page_uses_context_page_title` | Outdated route | Uses `/trade/investment`. |
| `build_quote_profile_payload_uses_bare_symbol_for_us_broker_tickers` | Intentional product behavior | Payload ticker is canonical bare `TSM`. |
| `compare_page_checks_each_selected_ticker_for_fresh_daily_cache` | Outdated route and Mock | Uses canonical route and accepts policy keywords. |
| `portfolio_page_uses_the_same_freshness_checks` | Outdated route and Mock | Uses canonical route and accepts policy keywords. |
| `exact_range_markup_exposes_shared_date_roles` | Outdated routes | Uses canonical Workspace routes. |
| `ibkr_csv_import_merges_incrementally_into_investment_store` | Outdated API contract | Asserts the compact response `summary`, not removed duplicate investment data. |
| `import_prewarms_all_investment_tickers_not_only_open_tickers` | Outdated helper Patch | Patches `ensure_latest_investment_daily_caches`. |
| `investment_transactions_attempts_profile_fetch_when_logo_asset_is_missing` | Intentional product behavior | Missing identity assets now request a forced refresh. |
| `investment_transactions_refresh_open_tickers_via_shared_freshness_helper` | Outdated helper Patch | Patches the investment-specific freshness boundary. |
| `investment_transactions_skip_money_market_freshness_refresh` | Outdated helper Patch | Patches the investment-specific freshness boundary. |
| `legacy_invest_routes_redirect_to_more_investment` | Outdated redirect contract | Compatibility aliases now redirect to `/trade/investment`. |
| `more_investment_page_exposes_dual_csv_import_form` | Outdated route | Uses `/trade/investment`. |
| `more_investment_page_exposes_markdown_export_button` | Outdated route | Uses `/trade/investment`. |
| `more_investment_page_renders_from_more_section` | Outdated route and markup | Uses the Trade route and current card classes. |
| `more_timing_page_renders_after_storage_refactor` | Intentional product behavior | Removed Timing redirects to Investment. |
| `primary_workspace_pages_render_after_runtime_split` | Outdated routes | Uses canonical Workspace routes. |
| `frosted_glass_baseline_material_defaults_match_foundation_css` | Real regression | Runtime material default was synchronized with foundation CSS. |
| `loader_reads_foundation_root_tokens` | Intentional material change | Tooltip uses the extracted frosted-glass material. |
| `style_and_font_runtime_defaults_match_foundation_css_baseline` | Real regression | Runtime control and pagination defaults were synchronized with CSS. |
| `compare_portfolio_and_backtest_pages_keep_controls_inside_workspace` | Outdated routes, labels, and Mock | Uses canonical routes, current labels, and shared factories. |

## Open issues

- Browser requests show missing optional `HelveticaNeueforHSBCW84` WOFF2 assets; the committed TTF fallback loads successfully. This should be cleaned up or the missing assets should be supplied.
- Overall Python coverage is `46.2%`; the weakest modules are listed in `TESTING.md`.
- Core runtime and investment-import modules remain oversized and expensive to reason about.
- E2E currently covers Chromium only. Add WebKit when its rendering differences can be maintained without making the local gate excessively slow.
