/* Backtest interval synchronization contract tests. Code version: v1.2.0 */

import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const APP_SOURCE = await readFile(
    new URL("../app/web/static/assets/js/app.js", import.meta.url),
    "utf8",
);
const SYNC_SOURCE = APP_SOURCE.slice(
    APP_SOURCE.indexOf("const getRequiredBacktestTickerSnapshot"),
    APP_SOURCE.indexOf("const syncDateConstraints"),
);
const CONTRACT_SOURCE = APP_SOURCE.slice(
    APP_SOURCE.indexOf("const backtestTickerSnapshotsMatch"),
    APP_SOURCE.indexOf("const syncBacktestIntervals"),
);

const createContract = ({requestToken = 0, requiredTickerCount = 1, tickers = []} = {}) => {
    const context = {
        backtestIntervalRequestToken: requestToken,
        getMinimumRequiredTickers: () => requiredTickerCount,
        getRequiredBacktestTickerSnapshot: () => tickers,
    };
    vm.runInNewContext(
        `${CONTRACT_SOURCE}\nglobalThis.contract = {`
        + "backtestTickerSnapshotsMatch, intersectBacktestPeriodOptions, canApplyBacktestIntervalResponse};",
        context,
    );
    return {context, contract: context.contract};
};

test("intersects Period options across every required Backtest ticker", () => {
    const {contract} = createContract();
    const shared = contract.intersectBacktestPeriodOptions({
        periodOptions: {
            QQQ: {"1d": ["1d", "1mo", "1y", "max"], "1m": ["1d", "3d", "max"]},
            TQQQ: {"1d": ["1d", "1mo", "max"], "1m": ["1d", "max"]},
        },
    }, ["QQQ", "TQQQ"]);

    assert.deepEqual(Array.from(shared["1d"]), ["1d", "1mo", "max"]);
    assert.deepEqual(Array.from(shared["1m"]), ["1d", "max"]);
    assert.match(SYNC_SOURCE, /\.slice\(0, requiredTickerCount\)/);
    assert.match(SYNC_SOURCE, /tickerSnapshot\.forEach\(\(ticker\) => params\.append\("ticker", ticker\)\)/);
    assert.match(SYNC_SOURCE, /tickerSnapshot\.every\(\(ticker\) => payload\.has1m\?\.\[ticker\] === true\)/);
    assert.match(APP_SOURCE, /state\.strategySupports\?\.execution_intervals/);
});

test("rejects stale Backtest interval responses before mutating state", () => {
    const {context, contract} = createContract({
        requestToken: 2,
        requiredTickerCount: 1,
        tickers: ["NVDA"],
    });

    assert.equal(contract.canApplyBacktestIntervalResponse(1, 1, ["AAPL"]), false);
    assert.equal(contract.canApplyBacktestIntervalResponse(2, 1, ["NVDA"]), true);
    context.backtestIntervalRequestToken = 3;
    assert.equal(contract.canApplyBacktestIntervalResponse(2, 1, ["NVDA"]), false);
    assert.match(SYNC_SOURCE, /const requestToken = \+\+backtestIntervalRequestToken;/);
    assert.ok(
        SYNC_SOURCE.indexOf("const requestToken = ++backtestIntervalRequestToken;")
            < SYNC_SOURCE.indexOf("if (tickerSnapshot.length < requiredTickerCount)"),
    );
    assert.match(
        SYNC_SOURCE,
        /if \(tickerSnapshot\.length < requiredTickerCount\) \{[\s\S]*setBacktestIntervalAvailability\(false\);[\s\S]*return;[\s\S]*\}\n\n        try \{/,
    );
    assert.ok(
        SYNC_SOURCE.indexOf("if (!canApplyBacktestIntervalResponse")
            < SYNC_SOURCE.indexOf("state.backtestPeriodOptions ="),
    );
});
