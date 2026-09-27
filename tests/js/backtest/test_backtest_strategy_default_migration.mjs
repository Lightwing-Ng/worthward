/* Previous-default migration contracts. Code version: v1.1.0 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const context = {window: {}};
vm.runInNewContext(readFileSync(new URL('../../../app/web/static/assets/js/app/strategy-controls.js', import.meta.url), 'utf8'), context);
const migrate = context.window.WORTHWARD_APP_STRATEGY_CONTROLS.migrateBacktestStrategyParamMemory;
const previousLstm = {
    "cell_display_threshold": "1.0",
    "chip_window": "232",
    "compute_backend": "CPU",
    "entry_probability": "60.0",
    "lstm_epochs": "19",
    "lstm_hidden_size": "23",
    "lstm_learning_rate": "0.005",
    "lstm_lookback": "16",
    "lstm_seed": "42",
    "training_window": "466",
    "use_amplitude": "0",
    "use_broker_holding": "0",
    "use_capital_flow": "0",
    "use_close_location": "1",
    "use_dividend_yield": "0",
    "use_dynamic_pe_ratio": "0",
    "use_fund_holder_weight": "0",
    "use_illiquidity_20d": "1",
    "use_intraday_return": "0",
    "use_market_temperature": "0",
    "use_momentum_20d": "0",
    "use_momentum_5d": "1",
    "use_momentum_60d": "0",
    "use_option_call_open_interest": "0",
    "use_option_call_volume": "0",
    "use_option_put_call_open_interest_ratio": "0",
    "use_option_put_call_volume_ratio": "0",
    "use_option_put_open_interest": "0",
    "use_option_put_volume": "0",
    "use_option_total_open_interest": "0",
    "use_option_total_volume": "0",
    "use_options": "0",
    "use_overnight_gap": "1",
    "use_pb_ratio": "0",
    "use_pe_ratio": "0",
    "use_ps_ratio": "0",
    "use_relative_volume_20d": "0",
    "use_return_1d": "0",
    "use_shareholder_concentration": "0",
    "use_short_interest": "0",
    "use_short_volume": "0",
    "use_turnover": "0",
    "use_volatility_20d": "1",
    "use_volume": "0",
    "use_volume_at_price": "1",
    "use_volume_change": "0"
};
const previousNvdaLstm = {
    ...previousLstm,
    chip_window: '21',
    lstm_epochs: '8',
    lstm_learning_rate: '0.03',
    lstm_lookback: '4',
    training_window: '252',
    use_close_location: '0',
    use_illiquidity_20d: '0',
    use_intraday_return: '1',
    use_momentum_20d: '1',
    use_momentum_5d: '0',
    use_option_call_volume: '1',
    use_option_total_volume: '1',
    use_return_1d: '1',
    use_turnover: '1',
    use_volatility_20d: '0',
    use_volume_change: '1',
};

test('untouched old defaults adopt current source defaults without changing other memories', () => {
    const memory = {'lstm-price-field': {...previousLstm}, macd: {fast: '9'}};
    const next = migrate(memory, 'lstm-price-field');
    assert.equal(next['lstm-price-field'], undefined);
    assert.equal(next.macd, memory.macd);
    assert.deepEqual(memory['lstm-price-field'], previousLstm);
});

test('one customized factor or training value preserves the entire saved profile', () => {
    for (const change of [{use_volume: '1'}, {lstm_epochs: '3'}, {compute_backend: 'Auto'}]) {
        const memory = {'lstm-price-field': {...previousLstm, ...change}};
        assert.equal(migrate(memory, 'lstm-price-field'), memory);
    }
});

test('partial, unknown, malformed, and extended records remain untouched', () => {
    const partial = {...previousLstm};
    delete partial.use_volume;
    for (const remembered of [partial, {...previousLstm, extra: '1'}, {...previousLstm, lstm_epochs: ''}, []]) {
        const memory = {'lstm-price-field': remembered};
        assert.equal(migrate(memory, 'lstm-price-field'), memory);
    }
    const memory = {macd: {fast: '9'}};
    assert.equal(migrate(memory, 'macd'), memory);
});

test('equivalent formatted numeric defaults still migrate', () => {
    const memory = {'lstm-price-field': {...previousLstm, training_window: '466.00', lstm_seed: '00042'}};
    assert.equal(migrate(memory, 'lstm-price-field')['lstm-price-field'], undefined);
});

test('untouched NVDA CPU defaults adopt the current Auto profile', () => {
    const memory = {'lstm-price-field': {...previousNvdaLstm}, macd: {fast: '9'}};
    const next = migrate(memory, 'lstm-price-field');
    assert.equal(next['lstm-price-field'], undefined);
    assert.equal(next.macd, memory.macd);
    assert.deepEqual(memory['lstm-price-field'], previousNvdaLstm);
});

test('customized and partial NVDA CPU profiles retain their selected backend', () => {
    const partial = {...previousNvdaLstm};
    delete partial.use_volume;
    for (const remembered of [
        {...previousNvdaLstm, lstm_epochs: '7'},
        {...previousNvdaLstm, use_volume: '1'},
        {...previousNvdaLstm, compute_backend: 'GPU'},
        {...previousNvdaLstm, compute_backend: 'Auto'},
        {...previousNvdaLstm, extra: '1'},
        partial,
    ]) {
        const memory = {'lstm-price-field': remembered};
        assert.equal(migrate(memory, 'lstm-price-field'), memory);
    }
});
