"""kit.money: see SPEC.md."""
from decimal import Decimal, ROUND_HALF_UP


def to_cents(amount):
    if isinstance(amount, bool):
        raise TypeError("amount must be int, float or str")
    if isinstance(amount, float):
        amount = repr(amount)
    if not isinstance(amount, (int, str)):
        raise TypeError("amount must be int, float or str")
    d = Decimal(str(amount).strip()) * 100
    return int(d.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def format_cents(cents):
    neg = cents < 0
    c = abs(cents)
    body = f"${c // 100:,}.{c % 100:02d}"
    return f"({body})" if neg else body
