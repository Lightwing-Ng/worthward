/**
 * Pure investment table filter helpers.
 *
 * Code version: v1.3.0
 */
(function bootstrapInvestmentFilterUtils(globalScope) {
    "use strict";

    const VALID_SUMMARY_SCOPES = new Set(["all", "filtered", "both"]);

    const normalizeTransactionType = (value) => String(value || "")
        .trim()
        .replace(/\s+/g, "_")
        .toLowerCase();

    const normalizeSideFilter = (value) => {
        if (Array.isArray(value)) {
            return Array.from(new Set(value
                .map(normalizeTransactionType)
                .filter((item) => item && !["all", "none"].includes(item))));
        }
        const normalized = normalizeTransactionType(value);
        if (["all", "none"].includes(normalized)) return normalized;
        return normalized ? [normalized] : "all";
    };

    const matchesSideFilter = (transaction, filterValue = "all") => {
        const normalizedFilter = normalizeSideFilter(filterValue);
        if (normalizedFilter === "all") return true;
        if (normalizedFilter === "none") return false;
        return normalizedFilter.includes(normalizeTransactionType(transaction?.type));
    };

    const normalizeSummaryScope = (value) => {
        const normalized = String(value || "").trim().toLowerCase();
        return VALID_SUMMARY_SCOPES.has(normalized) ? normalized : "all";
    };

    const buildSummaryCountLabel = ({ allCount = 0, filteredCount = 0, scope = "all" } = {}) => {
        const normalizedScope = normalizeSummaryScope(scope);
        const normalizedAllCount = Math.max(0, Number(allCount) || 0);
        const normalizedFilteredCount = Math.max(0, Number(filteredCount) || 0);
        if (normalizedScope === "filtered") return `${normalizedFilteredCount} filtered`;
        if (normalizedScope === "both") return `${normalizedFilteredCount} filtered of ${normalizedAllCount}`;
        return `${normalizedAllCount} total`;
    };

    const api = Object.freeze({
        buildSummaryCountLabel,
        matchesSideFilter,
        normalizeSideFilter,
        normalizeSummaryScope,
        normalizeTransactionType,
    });
    globalScope.ANTIGRAVITY_INVESTMENT_FILTERS = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
}(typeof window !== "undefined" ? window : globalThis));
