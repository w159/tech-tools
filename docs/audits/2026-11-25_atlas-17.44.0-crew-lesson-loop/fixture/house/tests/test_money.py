import pytest
from kit.money import to_cents, format_cents


def test_int():
    assert to_cents(3) == 300


def test_str():
    assert to_cents("12.34") == 1234


def test_half_up():
    assert to_cents("0.125") == 13
    assert to_cents("0.135") == 14


def test_half_away_from_zero_negative():
    assert to_cents("-0.125") == -13


def test_float_uses_shortest_repr():
    assert to_cents(2.675) == 268
    assert to_cents(1.005) == 101


def test_format_basic():
    assert format_cents(123450) == "$1,234.50"
    assert format_cents(5) == "$0.05"


def test_format_negative_parens():
    assert format_cents(-123450) == "($1,234.50)"


def test_format_zero():
    assert format_cents(0) == "$0.00"


def test_bool_rejected():
    with pytest.raises(TypeError):
        to_cents(True)
