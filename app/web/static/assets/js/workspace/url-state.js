/*
 * Canonical Workspace URL state parsing and serialization.
 *
 * Code version: v1.3.0
 */
(() => {
    const VERSION = "v1.3.0";
    const DEFAULT_PERIOD = "1y";
    const PERIOD_VALUES = new Set([
        "1d",
        "3d",
        "1w",
        "2w",
        "1mo",
        "3mo",
        "6mo",
        "1y",
        "2y",
        "3y",
        "5y",
        "10y",
        "max",
    ]);
    const CANONICAL_PARAMETER_NAMES = Object.freeze([
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
        "allocation",
        "weight",
        "shares",
        "strategy",
        "capital",
        "interval",
        "stop_loss",
        "amount",
        "frequency",
        "weekday",
        "month-day",
        "tab",
        "page",
    ]);
    const LEGACY_PARAMETER_NAMES = new Set([
        "ticker",
        "metric",
        "tickers",
        "ticker_a",
        "ticker_b",
        "range",
        "range_mode",
        "period",
        "trading_date",
        "exact_trading_date",
        "from",
        "exact_start",
        "to",
        "exact_end",
        "return",
        "price_only",
        "price_return_only",
        "dividends",
        "include_dividends",
        "extended-hours",
        "extended_hours",
        "include_extended_hours",
        "overnight",
        "include_overnight",
        "allocation",
        "weight",
        "shares",
        "strategy",
        "capital",
        "initial_capital",
        "interval",
        "stop_loss",
        "amount",
        "frequency",
        "weekday",
        "month-day",
        "month_day",
        "tab",
        "trade_detail_tab",
        "page",
    ]);
    const PRESERVED_PARAMETER_NAMES = new Set([
        "notice",
        "error",
        "broker_test_status",
        "broker_test_message",
        "broker_test_checked_at",
    ]);

    const resolveUrl = (input) => {
        if (input instanceof URL) return new URL(input.href);
        if (input && typeof input === "object" && typeof input.href === "string") {
            return new URL(input.href, "http://localhost");
        }
        return new URL(String(input || ""), "http://localhost");
    };

    const normalizeValue = (value) => String(value ?? "").trim();
    const strategyParamValuesMatch = (value, defaultValue) => {
        const normalizedValue = normalizeValue(value);
        const normalizedDefault = normalizeValue(defaultValue);
        if (normalizedValue === normalizedDefault) return true;
        if (!normalizedValue || !normalizedDefault) return false;
        const numericValue = Number(normalizedValue);
        const numericDefault = Number(normalizedDefault);
        return Number.isFinite(numericValue)
            && Number.isFinite(numericDefault)
            && numericValue === numericDefault;
    };
    const normalizeLower = (value) => normalizeValue(value).toLowerCase();
    const normalizeTicker = (value) => normalizeValue(value).toUpperCase();
    const normalizeComparisonMetric = (value) => (
        normalizeLower(value) === "market-cap" ? "market-cap" : "price"
    );

    const getDelimitedValues = (params, name) => params.getAll(name)
        .flatMap((value) => String(value || "").split(","))
        .map((value) => value.trim())
        .filter(Boolean);

    const uniquePreservingOrder = (values) => Array.from(new Set(values.filter(Boolean)));

    const parsePositiveInteger = (value, fallback = 1) => {
        const parsed = Number.parseInt(normalizeValue(value), 10);
        return Number.isFinite(parsed) ? Math.max(1, parsed) : fallback;
    };

    const parseFlag = (params, ...names) => names.some((name) => params.get(name) === "1");

    const normalizePeriod = (value, fallback = DEFAULT_PERIOD) => {
        const normalized = normalizeLower(value);
        return PERIOD_VALUES.has(normalized) ? normalized : fallback;
    };

    const readFirst = (params, names) => {
        for (const name of names) {
            const value = normalizeValue(params.get(name));
            if (value) return value;
        }
        return "";
    };

    const normalizeRangeState = (params, defaultPeriod) => {
        const rawRange = normalizeLower(readFirst(params, ["range", "range_mode"]));
        const isCustom = rawRange === "custom" || rawRange === "exact";
        const period = normalizePeriod(
            readFirst(params, ["period"]) || (!isCustom && PERIOD_VALUES.has(rawRange) ? rawRange : ""),
            defaultPeriod,
        );
        const date = readFirst(params, ["date", "trading_date", "exact_trading_date"]);
        const from = readFirst(params, ["from", "exact_start"]);
        const to = readFirst(params, ["to", "exact_end"]);
        const exactDate = period === "1d" && (date || (from && from === to))
            ? (date || from)
            : "";
        return {
            mode: isCustom ? "exact" : "period",
            period,
            range: isCustom ? "custom" : period,
            date: exactDate,
            from: exactDate ? exactDate : from,
            to: exactDate ? exactDate : to,
        };
    };

    const normalizeReturnMode = (params) => {
        const explicit = normalizeLower(params.get("return"));
        if (explicit === "price" || explicit === "total") return explicit;
        if (parseFlag(params, "price_only", "price_return_only")) return "price";
        return parseFlag(params, "dividends", "include_dividends") ? "dividends" : "total";
    };

    const parseWorkspaceUrlState = (input, {defaultPeriod = DEFAULT_PERIOD} = {}) => {
        const url = resolveUrl(input);
        const params = url.searchParams;
        const range = normalizeRangeState(params, normalizePeriod(defaultPeriod));
        const returnMode = normalizeReturnMode(params);
        const tickers = uniquePreservingOrder([
            ...getDelimitedValues(params, "ticker"),
            ...getDelimitedValues(params, "tickers"),
        ].map(normalizeTicker));
        const allocation = normalizeLower(params.get("allocation")) === "shares" ? "shares" : "weight";
        const values = (name) => params.getAll(name).map(normalizeValue).filter(Boolean);
        const tab = normalizeLower(params.get("tab") || params.get("trade_detail_tab"));
        const knownQueryState = [...CANONICAL_PARAMETER_NAMES, ...LEGACY_PARAMETER_NAMES]
            .some((name) => params.has(name));
        return {
            pathname: url.pathname,
            tickers,
            comparisonMetric: normalizeComparisonMetric(params.get("metric")),
            rangeMode: range.mode,
            range: range.range,
            period: range.period,
            date: range.date,
            from: range.from,
            to: range.to,
            returnMode,
            priceOnly: returnMode === "price",
            includeDividends: returnMode === "dividends",
            extendedHours: parseFlag(params, "extended-hours", "extended_hours", "include_extended_hours"),
            overnight: parseFlag(params, "overnight", "include_overnight"),
            allocation,
            weights: values("weight"),
            shares: values("shares"),
            strategy: normalizeValue(params.get("strategy")),
            capital: normalizeValue(params.get("capital") || params.get("initial_capital")),
            interval: normalizeLower(params.get("interval")),
            stopLossEnabled: params.has("stop_loss")
                ? parseFlag(params, "stop_loss")
                : true,
            amount: normalizeValue(params.get("amount")),
            frequency: normalizeLower(params.get("frequency")),
            weekday: normalizeValue(params.get("weekday")),
            monthDay: normalizeValue(params.get("month-day") || params.get("month_day")),
            tab: tab === "transactions" ? "transactions" : "metrics",
            page: parsePositiveInteger(params.get("page"), 1),
            hasExplicitState: knownQueryState,
        };
    };

    const setIfNonDefault = (params, name, value, defaultValue) => {
        const normalizedValue = normalizeValue(value);
        if (normalizedValue && normalizedValue !== normalizeValue(defaultValue)) {
            params.set(name, normalizedValue);
        }
    };

    const setRepeatedValues = (params, name, values) => {
        (values || [])
            .map(normalizeValue)
            .filter(Boolean)
            .forEach((value) => params.append(name, value));
    };

    const arraysEqual = (left, right) => (
        Array.isArray(left)
        && Array.isArray(right)
        && left.length === right.length
        && left.every((value, index) => normalizeValue(value) === normalizeValue(right[index]))
    );

    const clearWorkspaceParameters = (params, {preserveUnknown = false} = {}) => {
        Array.from(params.keys()).forEach((name) => {
            const isKnown = LEGACY_PARAMETER_NAMES.has(name) || /^((ticker|weight|shares)_\d+)$/.test(name);
            if (isKnown || (!preserveUnknown && !PRESERVED_PARAMETER_NAMES.has(name))) params.delete(name);
        });
    };

    const buildWorkspaceUrl = (input, state = {}, {
        defaultPeriod = DEFAULT_PERIOD,
        preserveUnknown = false,
    } = {}) => {
        const url = resolveUrl(input);
        const params = url.searchParams;
        clearWorkspaceParameters(params, {preserveUnknown});

        const tickers = (state.tickers || []).map(normalizeTicker);
        const defaultTickers = (state.defaultTickers || []).map(normalizeTicker);
        if (!arraysEqual(tickers, defaultTickers)) setRepeatedValues(params, "ticker", tickers);
        if (normalizeComparisonMetric(state.comparisonMetric || state.metric) === "market-cap") {
            params.set("metric", "market-cap");
        }

        const mode = normalizeLower(state.rangeMode || (state.range === "custom" ? "exact" : "period"));
        const period = normalizePeriod(state.period || state.range, normalizePeriod(defaultPeriod));
        if (mode === "exact") {
            params.set("range", "custom");
            params.set("period", period);
            const date = normalizeValue(state.date);
            if (period === "1d" && date) {
                params.set("date", date);
            } else {
                const from = normalizeValue(state.from);
                const to = normalizeValue(state.to);
                if (from) params.set("from", from);
                if (to) params.set("to", to);
            }
        } else {
            setIfNonDefault(params, "range", period, normalizePeriod(defaultPeriod));
        }

        const returnMode = normalizeLower(state.returnMode)
            || (state.priceOnly ? "price" : state.includeDividends ? "dividends" : "total");
        if (returnMode === "price") params.set("return", "price");
        else if (returnMode === "dividends") params.set("dividends", "1");
        if (state.extendedHours) params.set("extended-hours", "1");
        if (state.overnight) params.set("overnight", "1");

        if (state.isPortfolio) {
            const allocation = normalizeLower(state.allocation) === "shares" ? "shares" : "weight";
            if (allocation === "shares") {
                params.set("allocation", "shares");
                setRepeatedValues(params, "shares", state.shares || []);
            } else if (!arraysEqual(state.weights || [], state.defaultWeights || [])) {
                setRepeatedValues(params, "weight", state.weights || []);
            }
        }

        if (state.isBacktest) {
            setIfNonDefault(params, "strategy", state.strategy, state.defaultStrategy || "buy-and-hold");
            setIfNonDefault(params, "capital", state.capital, state.defaultCapital ?? "10000");
            setIfNonDefault(params, "interval", state.interval, state.defaultInterval || "1d");
            if (state.stopLossEnabled !== undefined) {
                const defaultStopLossEnabled = state.defaultStopLossEnabled ?? true;
                if (Boolean(state.stopLossEnabled) !== Boolean(defaultStopLossEnabled)) {
                    params.set("stop_loss", state.stopLossEnabled ? "1" : "0");
                }
            }
            (state.strategyParams || []).forEach(([key, value]) => {
                const normalizedKey = normalizeValue(key);
                const normalizedValue = normalizeValue(value);
                if (!normalizedKey || !normalizedValue) return;
                const defaultValue = state.strategyParamDefaults?.[normalizedKey];
                if (defaultValue !== undefined && strategyParamValuesMatch(normalizedValue, defaultValue)) return;
                params.set(normalizedKey, normalizedValue);
            });
        }

        if (state.isDca) {
            setIfNonDefault(params, "amount", state.amount, state.defaultAmount ?? "1000");
            setIfNonDefault(params, "frequency", state.frequency, state.defaultFrequency || "monthly");
            if (normalizeLower(state.frequency) === "weekly") {
                setIfNonDefault(params, "weekday", state.weekday, state.defaultWeekday ?? "0");
            }
            if (normalizeLower(state.frequency) === "monthly") {
                setIfNonDefault(params, "month-day", state.monthDay, state.defaultMonthDay ?? "15");
            }
        }

        if (state.tab === "transactions") params.set("tab", "transactions");
        const page = parsePositiveInteger(state.page, 1);
        if (page > 1) params.set("page", String(page));
        url.hash = "";
        return `${url.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
    };

    const api = Object.freeze({
        VERSION,
        CANONICAL_PARAMETER_NAMES,
        parseWorkspaceUrlState,
        buildWorkspaceUrl,
        getParameterNames: () => [...CANONICAL_PARAMETER_NAMES],
    });
    window.ANTIGRAVITY_WORKSPACE_URL_STATE = api;
})();
