from app.core.broker_catalog import (
    INVESTMENT_IMPORT_BROKER_CODES,
    LIVE_TRADING_BROKER_CODES,
    SETTINGS_BROKER_CODES,
    broker_pinyin_sort_key,
    sort_broker_codes,
    sorted_broker_entries,
)


def test_sort_broker_codes_orders_by_pinyin_initial_for_investment_import():
    assert sort_broker_codes(["longbridge", "hsbc", "ibkr", "futuhk"]) == [
        "futuhk",
        "hsbc",
        "ibkr",
        "longbridge",
    ]
    assert sort_broker_codes(["ibkr", "hsbc", "longbridge", "futuhk"]) == [
        "futuhk",
        "hsbc",
        "ibkr",
        "longbridge",
    ]
    assert sort_broker_codes(["hsbc", "longbridge", "ibkr", "futuhk"]) == [
        "futuhk",
        "hsbc",
        "ibkr",
        "longbridge",
    ]


def test_sorted_broker_entries_preserves_catalog_labels():
    entries = sorted_broker_entries(INVESTMENT_IMPORT_BROKER_CODES)
    # pinyin order: charlesschwab, cmbwinglungbank, futuhk, hsbc, ibkr, longbridge*
    codes = [entry.code for entry in entries]
    assert "schwab" in codes and "cmbwl" in codes
    assert codes.index("schwab") < codes.index("cmbwl")
    assert codes.index("futuhk") < codes.index("hsbc") < codes.index("ibkr")


def test_settings_and_live_trading_broker_lists_use_ibkr_before_longbridge():
    assert sort_broker_codes(SETTINGS_BROKER_CODES) == ["ibkr", "longbridge"]
    assert sort_broker_codes(LIVE_TRADING_BROKER_CODES) == ["ibkr", "longbridge"]


def test_broker_pinyin_sort_key_falls_back_to_code():
    assert broker_pinyin_sort_key("hsbc") == "hsbc"
    assert broker_pinyin_sort_key("unknown", fallback_label="Zebra") == "zebra"