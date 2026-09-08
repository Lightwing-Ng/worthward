/* Portfolio preview allocation contract tests. Code version: v1.0.0 */

import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const SOURCE_PATH = new URL("../app/web/static/assets/js/portfolio.js", import.meta.url);
const SOURCE = await readFile(SOURCE_PATH, "utf8");

const createPreviewApi = () => {
    const window = {};
    vm.runInNewContext(SOURCE, {Array, Math, Number, Object, String, window}, {
        filename: SOURCE_PATH.pathname,
    });
    return window.WORTHWARD_PORTFOLIO_PREVIEW;
};

test("normalizes share allocation from aligned opening prices", () => {
    const api = createPreviewApi();
    const entries = api.normalizeShareAllocationEntries([
        {ticker: "QQQ", shares: 2, initial_price: 100},
        {ticker: "AAPL", shares: 1, initial_price: 300},
    ]);

    assert.deepEqual(
        entries.map((entry) => [entry.ticker, entry.shares, entry.weight]),
        [["QQQ", 2, 40], ["AAPL", 1, 60]],
    );
});

test("uses the current ticker price resolver after a shares edit", () => {
    const api = createPreviewApi();
    const prices = new Map([["QQQ", 100], ["AAPL", 200]]);
    const entries = api.normalizeShareAllocationEntries([
        {ticker: "QQQ", shares: 4, weight: 50},
        {ticker: "AAPL", shares: 1, weight: 50},
    ], (ticker) => prices.get(ticker));

    assert.deepEqual(entries.map((entry) => entry.ticker), ["QQQ", "AAPL"]);
    assert.ok(Math.abs(entries[0].weight - (200 / 3)) < 1e-12);
    assert.ok(Math.abs(entries[1].weight - (100 / 3)) < 1e-12);
});

test("refuses to guess a share allocation when an opening price is unavailable", () => {
    const api = createPreviewApi();

    assert.equal(api.normalizeShareAllocationEntries([
        {ticker: "QQQ", shares: 2, initial_price: 100},
        {ticker: "UNKNOWN", shares: 1},
    ]), null);
});
