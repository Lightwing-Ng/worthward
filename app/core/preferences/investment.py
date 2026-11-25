"""Investment accounting and display preference persistence.

Code version: v0.3.0
"""

from __future__ import annotations

from typing import Literal, cast

from app.core.preferences.store import load_settings_section, update_settings_section

InvestmentCostBasisMethod = Literal[
    "lowest_cost_first",
    "fifo",
    "lifo",
    "moving_average",
]

DEFAULT_INVESTMENT_COST_BASIS_METHOD: InvestmentCostBasisMethod = "lowest_cost_first"
INVESTMENT_COST_BASIS_METHODS: tuple[InvestmentCostBasisMethod, ...] = (
    "lowest_cost_first",
    "fifo",
    "lifo",
    "moving_average",
)


def normalize_investment_cost_basis_method(value: object) -> InvestmentCostBasisMethod:
    normalized = str(value or "").strip().lower()
    if normalized in INVESTMENT_COST_BASIS_METHODS:
        return cast(InvestmentCostBasisMethod, normalized)
    return DEFAULT_INVESTMENT_COST_BASIS_METHOD


def load_investment_cost_basis_method() -> InvestmentCostBasisMethod:
    payload = load_settings_section("investment")
    return normalize_investment_cost_basis_method(payload.get("cost_basis_method"))


def save_investment_cost_basis_method(value: object) -> InvestmentCostBasisMethod:
    selected = normalize_investment_cost_basis_method(value)
    update_settings_section("investment", {"cost_basis_method": selected})
    return selected


def load_investment_show_broker_realized_pnl() -> bool:
    return load_settings_section("investment").get("show_broker_realized_pnl") is True


def save_investment_show_broker_realized_pnl(enabled: bool) -> None:
    update_settings_section(
        "investment", {"show_broker_realized_pnl": enabled},
    )


def _validated_portfolio_lot_assignments(value: object) -> dict[str, list[str]]:
    if not isinstance(value, dict):
        raise ValueError("Portfolio lot assignments must map sells to buy lots.")

    assignments: dict[str, list[str]] = {}
    assigned_buys: set[str] = set()
    for sell_key, buy_keys in value.items():
        if not isinstance(sell_key, str) or not sell_key.strip():
            raise ValueError("Each portfolio lot assignment requires a sell key.")
        if not isinstance(buy_keys, list) or not buy_keys:
            raise ValueError("Each portfolio lot assignment requires buy keys.")

        lots: list[str] = []
        for buy_key in buy_keys:
            if not isinstance(buy_key, str) or not buy_key.strip():
                raise ValueError("Each assigned portfolio lot requires a buy key.")
            if buy_key in value or buy_key in assigned_buys:
                raise ValueError("A buy lot may be assigned to only one sale.")
            assigned_buys.add(buy_key)
            lots.append(buy_key)
        assignments[sell_key] = lots
    return assignments


def load_investment_portfolio_lot_assignments() -> dict[str, list[str]]:
    value = load_settings_section("investment").get("portfolio_lot_assignments", {})
    try:
        return _validated_portfolio_lot_assignments(value)
    except ValueError:
        return {}


def save_investment_portfolio_lot_assignments(value: object) -> None:
    assignments = _validated_portfolio_lot_assignments(value)
    update_settings_section("investment", {"portfolio_lot_assignments": assignments})
