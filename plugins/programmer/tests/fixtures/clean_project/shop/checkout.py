"""Use case: charge a customer for an order."""

import logging
import uuid
from decimal import Decimal

from shop.domain.ports import CustomerRepository, PaymentGateway
from shop.domain.pricing import COUPON_DISCOUNT, VAT_RATE, Line, order_total

log = logging.getLogger(__name__)


class Checkout:
    def __init__(self, payments: PaymentGateway, customers: CustomerRepository):
        self._payments = payments
        self._customers = customers

    def total_for(self, lines: list[Line], region: str, coupon: str | None) -> Decimal:
        tax = VAT_RATE if region == "EU" else Decimal(0)
        discount = COUPON_DISCOUNT if coupon else Decimal(0)
        return order_total(lines, tax, discount)

    def place(self, customer_id: str, lines: list[Line], region: str, coupon: str | None) -> str:
        amount = self.total_for(lines, region, coupon)
        key = str(uuid.uuid4())
        try:
            return self._payments.charge(customer_id, amount, key)
        except Exception:
            log.exception("charge failed for %s", customer_id)
            raise

    def destination(self, customer_id: str) -> str:
        return self._customers.shipping_zip(customer_id)
