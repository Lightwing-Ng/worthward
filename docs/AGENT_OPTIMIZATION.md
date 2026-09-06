# OpenAI Site tools and Agent Optimization

Documentation version: `v1.2.3`

This project implements the shared Agent Optimization contract at
`/Users/example/Desktop/SHARED_AGENT_OPTIMIZATION.md`. That file owns the cross-project naming,
schema, result, security, lifecycle, evaluation, and promotion rules. This document owns only the
Worthward adapter and its verification evidence.

## Runtime adapter

| Boundary | Project implementation |
| --- | --- |
| Shared runtime | `app/web/static/assets/js/agent-optimization.js` |
| Project manifest | `app/web/templates/_agent_optimization.html` |
| Shared page bootstrap | `app/web/templates/base.html` |
| Node contract tests | `tests/test_agent_optimization.mjs` |
| Flask render tests | `tests/test_agent_optimization.py` |
| Disposable-browser tests | `tests/test_agent_optimization_browser.py` and `tests/e2e/agent-optimization.spec.mjs` |

The runtime is byte-identical to the sibling agenticContext copy and registers tools only when
the top-level document exposes `document.modelContext.registerTool`. Unsupported browsers receive the
normal interface without an error or behavioral fork. The project manifest publishes the executable
`webmcpTools` metadata consumed by the shared runtime; the adapter remains the owner of its trusted
descriptions and schemas.

The protected Live trading PIN page does not load Site tools. Canonical Workspace, Investment, and
Settings renderers load the same safe v1 inventory through `base.html`.

## v1 tools

| Tool | Result | Data boundary |
| --- | --- | --- |
| `get_site_capabilities` | Five static capability groups and seven allowlisted destinations | Does not read market series, investment records, broker state, or settings values |
| `get_page_context` | Site ID, title, language, route, and matching destination | Reads zero page-content fields and never serializes `WORTHWARD_APP` |
| `navigate_to_site_target` | Same-origin destination and scheduling evidence | Navigates only; it does not submit a form, import, cache action, or order |

The allowlisted destinations are `/workspaces/compare`, `/workspaces/prices`,
`/workspaces/prices?metric=market-cap`, `/workspaces/portfolio`, `/workspaces/backtest`,
`/trade/investment`, and `/settings/about`.

## Explicit exclusions

The v1 adapter does not expose:

- Chart series, ticker search, realtime quotes, investment rows, balances, positions, transactions,
  account identifiers, or CSRF values.
- Investment import, reconciliation, calibration, transfer binding, transaction write, or deletion.
- Broker OAuth, credentials, access tokens, PINs, settings writes, SMTP secrets, or cache maintenance.
- Live trading reads or order submission.

Navigation to a normal Workspace may perform the application's existing page-load market-data flow.
The Site tool discloses a normal page load and does not claim that navigation is network-free. Future
business tools must follow the shared promotion workflow, reuse existing navigation, parsing,
service, authorization, and readback contracts, and remain isolated from protected financial data by
default.

## Automated verification

Run the focused contract, rendering, and random-port disposable-browser layers with:

```bash
node --test tests/test_agent_optimization.mjs
./scripts/test.sh -p no:cacheprovider \
  tests/test_agent_optimization.py \
  tests/test_agent_optimization_browser.py
```

Run the isolated project Playwright case and complete gate with:

```bash
./scripts/test_e2e.sh tests/e2e/agent-optimization.spec.mjs
./scripts/check.sh
```

The Python browser test uses a random loopback port. The project Playwright gate owns port 8699 and
must not reuse the user-owned 8688 service. Both use isolated settings and disposable Chromium
contexts; neither submits a broker import or order.

Current automated evidence from 30 Aug 2026: all 9 shared Node contract cases, the focused Flask
and random-port browser cases, 954 full-suite Python tests, all 293 Node tests, and all 267
repository-native Playwright tests passed. The shared runtime is byte-identical to agenticContext
at SHA-256 `bffacd17ddfd40c0febd57e6ecb53022b7f5f68ba0238808433a09011214ed5c`. The full gate's
JavaScript report measured the shared runtime at 86.84% lines, 67.46% branches, and 100.00%
functions.

## OpenAI built-in Browser smoke test

This manual check depends on current OpenAI rollout and is not a CI gate:

1. Update the ChatGPT desktop app and enable Site tools under Browser permissions.
2. Open an isolated local test instance in the built-in Browser.
3. Inspect Available Site tools and confirm exactly three tools, with two read tools and one
   navigation tool.
4. Run `get_site_capabilities` and verify five capabilities plus seven destinations.
5. Run `navigate_to_site_target` with `ticker_comparison`; verify the visible URL and page.
6. Review the invocation under Recently used.
7. Confirm the protected Live trading PIN page exposes no Site tools.

Use GPT-5.6 Sol or GPT-5.6 Terra for the current OpenAI compatibility check. GPT-5.6 Luna currently
has WebMCP disabled. Treat this as client compatibility, not application logic.

Last recorded manual evidence from 28 Aug 2026: the ChatGPT built-in Browser discovered exactly
the three v1 tools on an isolated port 8701 Settings page, returned the five-capability and
seven-destination inventory, returned bounded Settings context, navigated through the Site tool to
the empty isolated Investment workspace, and discovered a fresh three-tool set whose context
matched `investment_workspace`. The isolated settings store was stopped and removed after the
check. The 30 Aug 2026 completion work did not rerun this rollout-dependent smoke test.

Official reference: [OpenAI Site tools](https://learn.chatgpt.com/docs/webmcp).
