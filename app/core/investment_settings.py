"""Investment accounting preference persistence.

Code version: v0.1.0
"""

from __future__ import annotations

from typing import Literal, cast

from app.core.settings_store import load_settings_section, save_settings_section

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
    payload = load_settings_section("investment")
    save_settings_section(
        "investment",
        {
            **payload,
            "cost_basis_method": selected,
        },
    )
    return selected
