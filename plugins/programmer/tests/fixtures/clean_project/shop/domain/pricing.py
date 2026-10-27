"""Pricing rules. Pure functions, no I/O."""

from dataclasses import dataclass
from decimal import Decimal

VAT_RATE = Decimal("0.20")
COUPON_DISCOUNT = Decimal("0.10")


@dataclass(frozen=True)
class Line:
    sku: str
    unit_price: Decimal
    qty: int


def line_total(line: Line) -> Decimal:
    if line.qty <= 0:
        raise ValueError(f"quantity must be positive for {line.sku}")
    return line.unit_price * line.qty


def order_total(lines: list[Line], taxed: Decimal, discount: Decimal) -> Decimal:
    subtotal = sum((line_total(x) for x in lines), Decimal(0))
    return subtotal * (1 + taxed) * (1 - discount)
