/** Standard table and investment filter contract tests. Code version: v1.3.0. */

import assert from "node:assert/strict";
import test from "node:test";

await import("../app/web/static/assets/js/table-controller.js");
await import("../app/web/static/assets/js/investment-filter-utils.js");
const tableController = globalThis.ANTIGRAVITY_TABLES;
const investmentFilters = globalThis.ANTIGRAVITY_INVESTMENT_FILTERS;

const transactions = [
    { id: 1, type: "buy" },
    { id: 2, type: "sell" },
    { id: 3, type: "dividend" },
];

test("All includes every transaction", () => {
    assert.deepEqual(
        transactions.filter((row) => investmentFilters.matchesSideFilter(row, "all")).map((row) => row.id),
        [1, 2, 3],
    );
});

test("Buy includes only buy transactions", () => {
    assert.deepEqual(
        transactions.filter((row) => investmentFilters.matchesSideFilter(row, "buy")).map((row) => row.id),
        [1],
    );
});

test("Sell includes only sell transactions", () => {
    assert.deepEqual(
        transactions.filter((row) => investmentFilters.matchesSideFilter(row, "sell")).map((row) => row.id),
        [2],
    );
});

test("None excludes every transaction", () => {
    assert.deepEqual(
        transactions.filter((row) => investmentFilters.matchesSideFilter(row, "none")),
        [],
    );
});

test("multiple checked sides include every selected transaction type", () => {
    assert.deepEqual(
        transactions.filter((row) => investmentFilters.matchesSideFilter(row, ["buy", "dividend"])).map((row) => row.id),
        [1, 3],
    );
    assert.deepEqual(
        investmentFilters.normalizeSideFilter(["sell", "sell", "foreign tax withholding"]),
        ["sell", "foreign_tax_withholding"],
    );
});

test("a side filter can deterministically produce no results", () => {
    assert.deepEqual(
        [{ id: 3, type: "dividend" }].filter((row) => investmentFilters.matchesSideFilter(row, "buy")),
        [],
    );
});

test("colspan empty and summary rows are never column measurement candidates", () => {
    const dataRow = { id: "data", cellSpans: [1, 1, 1] };
    const selected = tableController.selectMeasurementRowDescriptor([
        { id: "empty", empty: true, cellSpans: [3] },
        { id: "summary", summary: true, cellSpans: [1, 2] },
        dataRow,
    ], 3);
    assert.equal(selected, dataRow);
    assert.equal(tableController.selectMeasurementRowDescriptor([
        { id: "empty", empty: true, cellSpans: [3] },
    ], 3), null);
});

test("summary scopes have explicit all, filtered, and both labels", () => {
    assert.equal(investmentFilters.buildSummaryCountLabel({ allCount: 12, filteredCount: 4, scope: "all" }), "12 total");
    assert.equal(investmentFilters.buildSummaryCountLabel({ allCount: 12, filteredCount: 4, scope: "filtered" }), "4 filtered");
    assert.equal(investmentFilters.buildSummaryCountLabel({ allCount: 12, filteredCount: 4, scope: "both" }), "4 filtered of 12");
});
