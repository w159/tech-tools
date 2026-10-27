from dataclasses import dataclass
from typing import Protocol

from app.domain.money import Money


class OrderRepository(Protocol):
    def save(self, order: "Order") -> None: ...


@dataclass
class Order:
    total: Money
