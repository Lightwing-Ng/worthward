from pathlib import Path

from app.core.broker_catalog import (
    INVESTMENT_IMPORT_BROKER_CODES,
    BROKER_CATALOG,
    LIVE_TRADING_BROKER_CODES,
    SETTINGS_BROKER_CODES,
    broker_sort_key,
    sort_broker_codes,
    sorted_broker_entries,
)


def test_sort_broker_codes_orders_by_display_label_for_investment_import():
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
    # Alphabetical display-label order is applied by the canonical catalog sorter.
    codes = [entry.code for entry in entries]
    assert "schwab" in codes and "cmbwl" in codes
    assert codes.index("schwab") < codes.index("cmbwl")
    assert codes.index("futuhk") < codes.index("hsbc") < codes.index("ibkr")


def test_investment_institution_options_are_alphabetically_ordered():
    assert sort_broker_codes(INVESTMENT_IMPORT_BROKER_CODES) == [
        "boc_cn",
        "boc_hk",
        "schwab",
        "ccb_cn",
        "ccb_hk",
        "cmb_cn",
        "cmbwl",
        "futuhk",
        "hsbc",
        "ibkr",
        "icbc_cn",
        "icbc_hk",
        "longbridge_hk",
        "longbridge_sg",
        "standard_xlsx",
        "tigertrade",
        "usmart_hk",
        "zircon_hk",
    ]


def test_manual_bank_institutions_use_expected_pure_mark_assets():
    expected = {
        "cmb_cn": ("China Merchants Bank", "CMB Wing Lung.svg"),
        "boc_cn": ("Bank of China", "Bank of China.svg"),
        "boc_hk": ("Bank of China (Hong Kong)", "Bank of China.svg"),
        "icbc_cn": ("Industrial and Commercial Bank of China", "ICBC.svg"),
        "icbc_hk": ("Industrial and Commercial Bank of China (Asia)", "ICBC.svg"),
        "ccb_cn": ("China Construction Bank", "CCB.svg"),
        "ccb_hk": ("China Construction Bank (Asia)", "CCB.svg"),
    }
    logo_dir = Path(__file__).resolve().parents[1] / "market_store" / "logos" / "brokers"

    for code, (label, icon_filename) in expected.items():
        entry = BROKER_CATALOG[code]
        assert entry.label == label
        assert entry.icon_filename == icon_filename
        assert (logo_dir / icon_filename).is_file()

    assert BROKER_CATALOG["cmb_cn"].icon_filename == BROKER_CATALOG["cmbwl"].icon_filename
    assert BROKER_CATALOG["icbc_cn"].icon_filename == BROKER_CATALOG["icbc_hk"].icon_filename
    assert BROKER_CATALOG["ccb_cn"].icon_filename == BROKER_CATALOG["ccb_hk"].icon_filename


def test_manual_bank_institutions_are_generic_xlsx_import_choices():
    assert {"cmb_cn", "boc_cn", "boc_hk", "icbc_cn", "icbc_hk", "ccb_cn", "ccb_hk"}.issubset(
        INVESTMENT_IMPORT_BROKER_CODES
    )


def test_hk_bank_display_catalog_covers_restored_bank_records_and_logos():
    logo_dir = Path(__file__).resolve().parents[1] / "market_store" / "logos" / "brokers"
    expected = {
        "cmb_hk": ("China Merchants Bank Hong Kong Branch", "CMB Wing Lung.svg"),
        "standard_chartered_hk": ("Standard Chartered (HK)", "Standard Chartered.svg"),
        "welab_bank": ("WeLab Bank", "WeLab Bank.png"),
    }

    for code, (label, icon_filename) in expected.items():
        entry = BROKER_CATALOG[code]
        assert entry.label == label
        assert entry.icon_filename == icon_filename
        if icon_filename:
            assert (logo_dir / icon_filename).is_file()


def test_settings_and_live_trading_broker_lists_use_ibkr_before_longbridge():
    assert sort_broker_codes(SETTINGS_BROKER_CODES) == ["ibkr", "longbridge"]
    assert sort_broker_codes(LIVE_TRADING_BROKER_CODES) == ["ibkr", "longbridge"]


def test_broker_sort_key_falls_back_to_code():
    assert broker_sort_key("hsbc") == "hsbc"
    assert broker_sort_key("unknown", fallback_label="Zebra") == "zebra"
