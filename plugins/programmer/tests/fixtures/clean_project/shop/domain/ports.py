"""Interfaces the domain depends on. Adapters implement them."""

from decimal import Decimal
from typing import Protocol


class PaymentGateway(Protocol):
    def charge(self, customer_id: str, amount: Decimal, idempotency_key: str) -> str: ...


class CustomerRepository(Protocol):
    def shipping_zip(self, customer_id: str) -> str: ...
