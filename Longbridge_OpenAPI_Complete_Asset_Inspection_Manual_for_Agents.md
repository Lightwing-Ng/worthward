# Longbridge OpenAPI Complete Asset Inspection Manual for Agentic Coding

**Purpose**  
This manual provides a complete, production-ready specification for building a local AI agent that can fully inspect and reconcile a Longbridge securities account. It covers every major requirement for personal asset tracking:

- Complete deposits and withdrawals in HKD and USD  
- Currency conversions (FX)  
- Broker cash vouchers, promotional credits, and account adjustments  
- Stock and options trading history including all fees and commissions  
- Margin financing interest and related costs  
- Money market fund (MMF) and other fund subscriptions/redemptions  
- Current holdings snapshot (stocks + funds)  
- Real-time financing health, buying power, margin ratios, and risk status  

The design philosophy is "Cash Flow is the single source of truth for history; Account + Positions provide the current snapshot." Together they form a closed-loop inspection system suitable for daily/weekly reporting, P&L calculation, fee auditing, and risk monitoring inside a local agent framework (e.g., OpenClaw or similar).

**Intended Audience**  
Local agent developers who need precise, unambiguous instructions that frontier LLMs (GPT, Claude, Grok, etc.) can directly consume as system prompts or tool descriptions.

**Version**  
2026-06-16 | Base URL: https://open.longbridge.com | Official Reference: https://open.longbridge.com/docs

---

## 1. Authentication and Environment Setup

Use API Key mode for agent workloads.

Required environment variables (set before any call):

```bash
export LONGBRIDGE_APP_KEY="your_app_key"
export LONGBRIDGE_APP_SECRET="your_app_secret"
export LONGBRIDGE_ACCESS_TOKEN="your_access_token"
```

All HTTP requests must include:
- `Authorization: Bearer <ACCESS_TOKEN>`
- `Content-Type: application/json; charset=utf-8`

**Recommended SDK initialization pattern (Python)**

```python
from longbridge.openapi import TradeContext, Config
from datetime import datetime, timezone

config = Config.from_env()          # Reads the three env vars above
ctx = TradeContext(config)          # Synchronous context; use AsyncTradeContext for high concurrency
```

For long-running agents, refresh the access token before the 90-day expiry using the OAuth endpoint or the SDK's refresh helper.

---

## 2. Rate Limits and Pagination (Agent Best Practices)

- Trade-related APIs (including cash flow, orders, executions, account): maximum 30 calls per 30 seconds. Enforce a minimum 0.1–0.2 s sleep between calls in agent loops.
- Quote APIs have higher limits; not relevant for asset inspection.
- Cash Flow supports `size` up to 10,000 per page. Always implement pagination using the `page` parameter and check for remaining records via response structure or by requesting the next page until empty.
- Orders and Executions return at most 1,000 records per call; paginate when necessary.
- Agent recommendation: Cache recent results (last 7–30 days) and only fetch deltas on subsequent runs. Use `business_time` or `submitted_at` as the watermark.

---

## 3. Core Endpoints and Data Models

### 3.1 Cash Flow — Primary Historical Record (`/v1/asset/cashflow`)

**Endpoint**  
`GET /v1/asset/cashflow`

**Required Parameters**  
- `start_time`: Unix timestamp in seconds (UTC)  
- `end_time`: Unix timestamp in seconds (UTC)  

**Optional Parameters**  
- `business_type`: 1 = cash, 2 = stock, 3 = fund  
- `symbol`: e.g., `AAPL.US` or `700.HK`  
- `page`, `size` (default 50, max 10,000)

**Why it is the single source of truth**  
Every money movement appears here: deposits, withdrawals, FX, stock/option buys and sells, every fee line item, financing interest, dividends, fund subscriptions/redemptions, and broker credits/vouchers. Order and execution endpoints give order lifecycle but fees are authoritative only in Cash Flow.

**Key Response Fields (per record in `data.list`)**  
- `transaction_flow_name`: The most important classification field. Common values include:  
  `Deposit`, `Withdrawal`, `CurrencyExchange`, `BuyContract-Stocks`, `SellContract-Stocks`, `Commission`, `PlatformFee`, `StampDuty`, `TradingFee`, `SettlementFee`, `Interest`, `Dividend`, `IPO`, `FundSubscription`, `FundRedemption`, and various adjustment/credit names.  
- `direction`: 1 = outflow (money leaving), 2 = inflow (money arriving)  
- `balance`: Amount as string (can be negative)  
- `currency`: `HKD`, `USD`, or `CNH`  
- `business_time`: Unix timestamp (seconds) when the event occurred  
- `symbol`: Associated instrument (empty for pure cash/FX events)  
- `description`: Human-readable text; critical for identifying special items such as financing interest details or cash vouchers.  
- `business_type`: 1/2/3 as above

**Agent Classification Logic (copy-paste ready)**

```python
def classify_cash_flow(records):
    """Return categorized buckets for downstream reporting and auditing."""
    buckets = {
        "deposits": [],
        "withdrawals": [],
        "fx_trades": [],
        "stock_buys": [],
        "stock_sells": [],
        "all_fees": [],
        "financing_interest": [],
        "dividends": [],
        "mmf_redemptions": [],
        "mmf_subscriptions": [],
        "cash_vouchers_and_credits": [],
        "other": []
    }
    fee_names = {"Commission", "PlatformFee", "StampDuty", "TradingFee", "SettlementFee"}
    interest_keywords = {"margin", "financing", "short selling", "interest"}

    for r in records:
        name = r.get("transaction_flow_name", "")
        desc = (r.get("description") or "").lower()
        btype = str(r.get("business_type", ""))

        if name == "Deposit":
            if any(kw in desc for kw in ["voucher", "promo", "credit", "赠送", "adjustment", "cash coupon", "broker credit"]):
                buckets["cash_vouchers_and_credits"].append(r)
            else:
                buckets["deposits"].append(r)
        elif name == "Withdrawal":
            buckets["withdrawals"].append(r)
        elif name == "CurrencyExchange":
            buckets["fx_trades"].append(r)
        elif name == "BuyContract-Stocks":
            buckets["stock_buys"].append(r)
        elif name == "SellContract-Stocks":
            buckets["stock_sells"].append(r)
        elif name in fee_names:
            buckets["all_fees"].append(r)
        elif name == "Interest" and any(kw in desc for kw in interest_keywords):
            buckets["financing_interest"].append(r)
        elif name == "Dividend":
            buckets["dividends"].append(r)
        elif btype == "3" and "redemption" in name.lower():
            buckets["mmf_redemptions"].append(r)
        elif btype == "3" and "subscription" in name.lower():
            buckets["mmf_subscriptions"].append(r)
        else:
            buckets["other"].append(r)
    return buckets
```

**Important Notes for Agents**  
- Currency conversion always produces a pair of records (outflow in source currency + inflow in target currency) sharing the same `business_time`.  
- Financing interest is usually posted monthly; look in the `Interest` flow name + description keywords.  
- Cash vouchers and promotional credits almost always appear as special `Deposit` records. Rely on `description` parsing; maintain an extensible keyword list in your agent config.  
- Fund (MMF) activity uses `business_type=3`. Current holdings come from the Fund Positions endpoint; history and cash impact come from Cash Flow.

### 3.2 Account Assets — Current Financing Health and Cash Breakdown (`/v1/asset/account`)

**Endpoint**  
`GET /v1/asset/account?currency=HKD` (currency filter optional; omit for all currencies)

**Purpose**  
Returns the live snapshot of net assets, buying power, margin utilization, risk level, and detailed cash status per currency. This is mandatory for any complete inspection.

**Critical Response Fields (inside each item of `data.list`)**  
- `currency`  
- `net_assets`: Overall net worth in that currency  
- `total_cash`  
- `buy_power`: Effective purchasing power including available margin  
- `max_finance_amount`: Total margin facility  
- `remaining_finance_amount`: Unused margin capacity  
- `init_margin`, `maintenance_margin`  
- `margin_call`: Amount that must be deposited to avoid forced liquidation (alert if > 0)  
- `risk_level`: 0 = safe, 1 = medium, 2 = early warning, 3 = danger  
- `cash_infos[]`: Detailed breakdown per currency  
  - `withdraw_cash`, `available_cash`, `frozen_cash`, `settling_cash` (the last includes pending fund redemptions)  
- `frozen_transaction_fees[]`

**Agent Usage**  
Call this endpoint at the start of every inspection run. Compare `remaining_finance_amount` and `margin_call` against historical financing interest paid (from Cash Flow) to assess leverage cost vs. benefit. Store the snapshot with a timestamp for trend analysis.

### 3.3 Stock Positions — Current Equity Holdings (`/v1/asset/stock`)

**Endpoint**  
`GET /v1/asset/stock?symbol=AAPL.US` (symbol optional; omit to return all holdings)

**Key Response Fields (per position)**  
- `symbol`, `symbol_name`  
- `quantity`, `available_quantity` (sellable)  
- `cost_price`: Average cost basis  
- `currency`, `market`

**Agent Role**  
Provides the "what do I own right now" view. Combine with Cash Flow to calculate realized vs. unrealized P&L attribution and to verify that all historical buys/sells are consistent with current quantities.

### 3.4 Fund Positions — Money Market Funds and Other Funds

Longbridge exposes fund holdings via a parallel endpoint (commonly accessed through `longbridge fund-positions` CLI or the corresponding SDK method, typically `/v1/asset/fund`).

**Key Information**  
- Current quantity and market value of each fund (including MMFs used as cash sweep vehicles).  
- Historical subscription and redemption activity, cash impact, and in-transit amounts are already captured in Cash Flow (`business_type=3`).  
- `settling_cash` in the Account Assets response reflects pending fund movements.

**Agent Recommendation**  
Fetch Fund Positions on the same cadence as Stock Positions. Treat MMF redemptions as a special cash inflow category for liquidity and yield analysis.

### 3.5 Trade History — Orders and Executions (Supplementary Detail)

Use these when you need order lifecycle, status, or fill-level granularity beyond what Cash Flow provides.

- Historical Orders: `GET /v1/trade/order/history` (supports `market`, `start_at`, `end_at`, `symbol`)  
- Historical Executions: `GET /v1/trade/execution/history`  
- Today's versions exist for real-time needs.  
- Single Order Detail: `GET /v1/trade/order?order_id=...` (full fee breakdown and state history)

**Note on Options**  
The trade endpoints fully support options (and warrants) in addition to stocks. The same classification and reconciliation logic applies.

---

## 4. Recommended Agent Workflow (Step-by-Step Implementation)

Implement the following sequence inside your asset inspection tool. Each step is designed to be independently callable and cacheable.

**Step 1 – Fetch and Classify Full Historical Cash Flow**  
Request the desired date range (recommend keeping a persistent watermark of the last processed `business_time`). Run the classification function shown in 3.1. Persist both raw records and categorized buckets.

**Step 2 – Capture Current Account Snapshot**  
Call `/v1/asset/account`. Store the full response with timestamp. Extract key risk metrics (`risk_level`, `margin_call`, `remaining_finance_amount`) for alerting.

**Step 3 – Capture Current Positions**  
Call Stock Positions and Fund Positions in parallel. Store with timestamp. Compute simple aggregates (total equity value, top holdings concentration, etc.).

**Step 4 – Optional Deep Trade History**  
If the inspection is for a specific period or symbol, or if you need to audit a particular order's fee breakdown, fetch Orders + Executions and join on `order_id`.

**Step 5 – Cross-Reference and Compute Derived Metrics**  
- Join Cash Flow fee records to orders/executions via time window + symbol + amount.  
- Reconcile position quantities: sum of net buys/sells in Cash Flow should explain the delta between two position snapshots.  
- Calculate period totals:  
  - Total deposits / withdrawals (net cash in/out)  
  - Total fees paid by category  
  - Total financing interest paid  
  - Net MMF activity and estimated yield contribution (requires price lookup)  
  - Identified cash vouchers/credits (flag for manual review if large)  
- Multi-currency handling: always aggregate and report per currency; convert to reporting currency only at the final presentation layer using the Exchange Rates endpoint if needed.

**Step 6 – Generate Structured Output**  
Return a JSON or Markdown report containing:  
- Executive summary (net P&L drivers, risk status, major fee categories)  
- Categorized cash flow tables  
- Current holdings with cost basis and unrealized P&L (requires current quotes)  
- Financing utilization and interest cost analysis  
- Any anomalies (large vouchers, unusual Interest entries, reconciliation breaks)

**Recommended Cadence**  
- Daily / after market close: Steps 1 (last 7 days) + 2 + 3  
- Weekly or on demand: Full history + complete reconciliation report

---

## 5. Production Considerations for Robust Agents

**Caching and Watermarking**  
Maintain a local store (SQLite, JSONL, or vector DB) of processed cash flow records keyed by `business_time` + unique id. On each run, request only newer records.

**Idempotency**  
All GET endpoints are safe to retry. Use the same `start_time`/`end_time` window and de-duplicate on the agent side.

**Error Handling**  
- 429: Back off exponentially and respect the 30 calls / 30 s limit.  
- 401: Refresh token.  
- Partial data: Always validate that the returned page count or `has_more` flag is respected.  
- Data quality: After classification, run simple sanity checks (e.g., sum of deposits minus sum of withdrawals should be consistent with net cash change in Account snapshot over the same period).

**Multi-Currency Aggregation**  
Never mix HKD and USD in the same total without explicit conversion. Report native currency figures first, then optional converted totals.

**Options and Complex Instruments**  
The same Cash Flow + Positions pattern works. `symbol` will contain the option root or full contract specification when applicable.

---

## 6. CLI Commands for Development and Debugging

```bash
longbridge assets [--currency USD]          # Best daily snapshot (financing + cash breakdown)
longbridge cash-flow --start 2025-01-01 --end 2026-06-16
longbridge positions
longbridge fund-positions
longbridge margin-ratio TSLA.US             # Per-symbol margin factors (optional)
longbridge order detail <ORDER_ID>
longbridge --help
```

Use these during agent development to validate responses and to create golden test fixtures.

---

## 7. Quick Reference – Most Important Fields

**Cash Flow Record**  
`transaction_flow_name`, `direction`, `balance`, `currency`, `business_time`, `symbol`, `description`, `business_type`

**Account Snapshot**  
`net_assets`, `buy_power`, `remaining_finance_amount`, `margin_call`, `risk_level`, `cash_infos[].available_cash`, `cash_infos[].settling_cash`

**Stock Position**  
`symbol`, `quantity`, `available_quantity`, `cost_price`, `currency`

**Derived Metrics Your Agent Should Compute**  
- Total fees paid in period (by category)  
- Total financing interest paid  
- Net cash movement from deposits/withdrawals/FX  
- Identified cash vouchers/credits  
- Position reconciliation status (does history explain current holdings?)  
- Current leverage utilization and risk level trend

---

## 8. Summary and Integration Guidance

This specification gives a local agent everything required to maintain a trustworthy, auditable view of the entire Longbridge account without relying on the mobile app or web portal. Cash Flow delivers the immutable history of every dollar movement and cost. Account Assets and Positions deliver the live state. The classification logic and workflow above turn raw API responses into structured, reportable intelligence.

Copy the classification function, the workflow steps, and the field lists directly into your agent's tool implementations. Extend the keyword lists for cash vouchers and interest descriptions as you encounter new patterns in production.

If you need a ready-to-run Python class skeleton (`LongbridgeAssetInspector`), a database schema for persisting snapshots, or prompt templates that turn the inspection output into natural-language daily/weekly briefings, provide the request and I will generate it immediately. This manual is intentionally written to be directly usable by frontier models for agent coding.