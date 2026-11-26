from kit.money import to_cents, format_cents


def test_to_cents():
    assert to_cents(3) == 300
    assert to_cents("12.34") == 1234


def test_format():
    assert format_cents(123450) == "$1,234.50"
    assert format_cents(5) == "$0.05"
