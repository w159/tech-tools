import unittest
from decimal import Decimal

from shop.domain.pricing import Line, order_total


class Pricing(unittest.TestCase):
    def test_total(self):
        lines = [Line("a", Decimal("2.50"), 4)]
        self.assertEqual(order_total(lines, Decimal(0), Decimal(0)), Decimal("10.00"))
