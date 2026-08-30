/* Tests for the canonical Workspace URL state contract. Code version: v1.5.0 */

import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const SOURCE_PATH = new URL("../app/web/static/assets/js/workspace/url-state.js", import.meta.url);
const SOURCE = await readFile(SOURCE_PATH, "utf8");

const createRuntime = () => {
    const window = {};
    vm.runInNewContext(SOURCE, {URL, Set, Map, Number, String, Array, Object, window}, {
        filename: SOURCE_PATH.pathname,
    });
    return window.ANTIGRAVITY_WORKSPACE_URL_STATE;
};

test("publishes the canonical Workspace query contract", () => {
    const api = createRuntime();

    assert.equal(api.VERSION, "v1.5.0");
    assert.deepEqual(Array.from(api.getParameterNames()), [
        "ticker",
        "metric",
        "range",
        "period",
        "date",
        "from",
        "to",
        "return",
        "dividends",
        "extended-hours",
        "overnight",
        "chips",
        "allocation",
        "weight",
        "shares",
        "strategy",
        "capital",
        "interval",
        "stop_loss",
        "show_trade_details",
        "amount",
        "frequency",
        "weekday",
        "month-day",
        "tab",
        "page",
    ]);
});

test("uses price as the default Ticker comparison metric and serializes market cap explicitly", () => {
    const api = createRuntime();
    const defaultMetric = api.parseWorkspaceUrlState(
        "http://localhost:8688/workspaces/prices?ticker=NVDA&ticker=MSFT",
    );
    const marketCapMetric = api.parseWorkspaceUrlState(
        "http://localhost:8688/workspaces/prices?metric=market-cap&ticker=NVDA&ticker=MSFT",
    );

    assert.equal(defaultMetric.comparisonMetric, "price");
    assert.equal(marketCapMetric.comparisonMetric, "market-cap");
    assert.equal(
        api.buildWorkspaceUrl(
            "http://localhost:8688/workspaces/prices?metric=price",
            {
                tickers: ["NVDA", "MSFT"],
                defaultTickers: [],
                rangeMode: "period",
                period: "1y",
                comparisonMetric: "price",
            },
        ),
        "/workspaces/prices?ticker=NVDA&ticker=MSFT",
    );
    assert.equal(
        api.buildWorkspaceUrl(
            "http://localhost:8688/workspaces/prices",
            {
                tickers: ["NVDA", "MSFT"],
                defaultTickers: [],
                rangeMode: "period",
                period: "1y",
                comparisonMetric: "market-cap",
            },
        ),
        "/workspaces/prices?ticker=NVDA&ticker=MSFT&metric=market-cap",
    );
});

test("serializes and parses the price comparison chips switch", () => {
    const api = createRuntime();
    const parsed = api.parseWorkspaceUrlState(
        "http://localhost:8688/workspaces/prices?ticker=AAPL&ticker=NVDA&chips=1",
    );

    assert.equal(parsed.showChips, true);
    assert.equal(
        api.buildWorkspaceUrl(
            "http://localhost:8688/workspaces/prices",
            {
                tickers: ["AAPL", "NVDA"],
                defaultTickers: [],
                rangeMode: "period",
                period: "1y",
                comparisonMetric: "price",
                showChips: true,
            },
        ),
        "/workspaces/prices?ticker=AAPL&ticker=NVDA&chips=1",
    );
});

test("parses canonical and legacy range shapes into one state", () => {
    const api = createRuntime();
    const canonical = api.parseWorkspaceUrlState(
        "http://localhost:8688/workspaces/compare?ticker=nvda&ticker=msft&range=custom&period=1d&date=2026-08-04&return=price",
    );
    const legacy = api.parseWorkspaceUrlState(
        "http://localhost:8688/workspaces/compare?ticker=nvda&ticker=msft&range=exact&period=1d&trading_date=2026-08-04&price_only=1",
    );

    assert.equal(JSON.stringify(canonical), JSON.stringify(legacy));
    assert.deepEqual(Array.from(canonical.tickers), ["NVDA", "MSFT"]);
    assert.equal(canonical.rangeMode, "exact");
    assert.equal(canonical.range, "custom");
    assert.equal(canonical.period, "1d");
    assert.equal(canonical.date, "2026-08-04");
    assert.equal(canonical.returnMode, "price");
});

test("omits defaults and serializes custom ranges with stable semantic names", () => {
    const api = createRuntime();

    assert.equal(
        api.buildWorkspaceUrl(
            "http://localhost:8688/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=1y&range=period&price_only=1#legacy",
            {
                tickers: ["qqq", "jepq"],
                defaultTickers: ["QQQ", "JEPQ"],
                rangeMode: "period",
                period: "1y",
                returnMode: "total",
            },
        ),
        "/workspaces/compare",
    );

    assert.equal(
        api.buildWorkspaceUrl(
            "http://localhost:8688/workspaces/prices",
            {
                tickers: ["NVDA", "MSFT"],
                defaultTickers: [],
                rangeMode: "exact",
                period: "1d",
                date: "2026-08-04",
                returnMode: "price",
            },
        ),
        "/workspaces/prices?ticker=NVDA&ticker=MSFT&range=custom&period=1d&date=2026-08-04&return=price",
    );
});

test("keeps portfolio order aligned across repeated tickers and allocations", () => {
    const api = createRuntime();

    assert.equal(
        api.buildWorkspaceUrl(
            "http://localhost:8688/workspaces/portfolio",
            {
                tickers: ["AAPL", "NVDA"],
                defaultTickers: [],
                rangeMode: "period",
                period: "3mo",
                isPortfolio: true,
                allocation: "weight",
                weights: [40, 60],
                defaultWeights: [],
            },
        ),
        "/workspaces/portfolio?ticker=AAPL&ticker=NVDA&range=3mo&weight=40&weight=60",
    );

    assert.equal(
        api.buildWorkspaceUrl(
            "http://localhost:8688/workspaces/portfolio",
            {
                tickers: ["NVDA", "AAPL", "QQQ"],
                defaultTickers: [],
                rangeMode: "period",
                period: "1y",
                isPortfolio: true,
                allocation: "weight",
                weights: [30, 30, 40],
                defaultWeights: [25, 25, 50],
            },
        ),
        "/workspaces/portfolio?ticker=NVDA&ticker=AAPL&ticker=QQQ&weight=30&weight=30&weight=40",
    );
});

test("serializes backtest and DCA options without their defaults", () => {
    const api = createRuntime();

    assert.equal(
        api.buildWorkspaceUrl(
            "http://localhost:8688/workspaces/backtest",
            {
                tickers: ["NVDA"],
                defaultTickers: [],
                rangeMode: "period",
                period: "6mo",
                isBacktest: true,
                strategy: "macd-crossover",
                defaultStrategy: "buy-and-hold",
                capital: "20000",
                defaultCapital: "10000",
                interval: "1m",
                defaultInterval: "1d",
                strategyParams: [["fast_period", "12"], ["slow_period", "26"]],
                strategyParamDefaults: {fast_period: "12", slow_period: "20"},
                tab: "transactions",
                page: 2,
            },
        ),
        "/workspaces/backtest?ticker=NVDA&range=6mo&strategy=macd-crossover&capital=20000&interval=1m&slow_period=26&tab=transactions&page=2",
    );

    assert.equal(
        api.buildWorkspaceUrl(
            "http://localhost:8688/workspaces/dca",
            {
                tickers: ["AAPL"],
                defaultTickers: [],
                rangeMode: "period",
                period: "1y",
                isDca: true,
                amount: "1500",
                defaultAmount: "1000",
                frequency: "weekly",
                defaultFrequency: "monthly",
                weekday: "4",
                defaultWeekday: "0",
                monthDay: "15",
                defaultMonthDay: "15",
            },
        ),
        "/workspaces/dca?ticker=AAPL&amount=1500&frequency=weekly&weekday=4",
    );
});

test("compares numeric strategy defaults by value instead of display precision", () => {
    const api = createRuntime();

    assert.equal(
        api.buildWorkspaceUrl(
            "http://localhost:8688/workspaces/backtest",
            {
                tickers: ["AAPL"],
                defaultTickers: [],
                rangeMode: "period",
                period: "6mo",
                isBacktest: true,
                strategy: "grid-trading",
                defaultStrategy: "grid-trading",
                capital: "10000",
                defaultCapital: "10000",
                interval: "1d",
                defaultInterval: "1d",
                strategyParams: [
                    ["price_floor", "1.00"],
                    ["price_ceiling", "1000.00"],
                    ["rise", "2.00"],
                    ["fall", "0.50"],
                ],
                strategyParamDefaults: {
                    price_floor: "1.0",
                    price_ceiling: "1000.0",
                    rise: "2.0",
                    fall: "0.5",
                },
            },
        ),
        "/workspaces/backtest?ticker=AAPL&range=6mo",
    );
});

test("serializes the shared backtest stop-loss switch against its default", () => {
    const api = createRuntime();

    assert.equal(
        api.buildWorkspaceUrl(
            "http://localhost:8688/workspaces/backtest",
            {
                tickers: ["AAPL"],
                defaultTickers: [],
                rangeMode: "period",
                period: "6mo",
                isBacktest: true,
                strategy: "grid-trading",
                defaultStrategy: "grid-trading",
                stopLossEnabled: false,
                defaultStopLossEnabled: true,
            },
        ),
        "/workspaces/backtest?ticker=AAPL&range=6mo&stop_loss=0",
    );

    const parsed = api.parseWorkspaceUrlState(
        "http://localhost:8688/workspaces/backtest?stop_loss=0",
    );
    assert.equal(parsed.stopLossEnabled, false);
});

test("serializes the shared backtest trade-details switch against its default", () => {
    const api = createRuntime();

    const defaultState = api.parseWorkspaceUrlState(
        "http://localhost:8688/workspaces/backtest?strategy=buy-and-hold",
    );
    assert.equal(defaultState.showTradeDetailsEnabled, true);
    assert.equal(
        api.buildWorkspaceUrl(
            "http://localhost:8688/workspaces/backtest?tab=transactions",
            {
                tickers: ["AAPL"],
                defaultTickers: [],
                rangeMode: "period",
                period: "1y",
                isBacktest: true,
                strategy: "buy-and-hold",
                defaultStrategy: "buy-and-hold",
                showTradeDetailsEnabled: false,
                defaultShowTradeDetailsEnabled: true,
            },
        ),
        "/workspaces/backtest?ticker=AAPL&show_trade_details=0",
    );

    const hiddenState = api.parseWorkspaceUrlState(
        "http://localhost:8688/workspaces/backtest?show_trade_details=0",
    );
    assert.equal(hiddenState.showTradeDetailsEnabled, false);
});
