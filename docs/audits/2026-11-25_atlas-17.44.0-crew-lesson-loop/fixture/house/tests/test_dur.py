import pytest
from kit.dur import format_duration, parse_duration


def test_zero():
    assert format_duration(0) == "0s"


def test_parts_space_separated():
    assert format_duration(3723) == "1h 2m 3s"


def test_zero_parts_omitted():
    assert format_duration(3600) == "1h"
    assert format_duration(3601) == "1h 1s"


def test_days():
    assert format_duration(90061) == "1d 1h 1m 1s"


def test_negative_raises():
    with pytest.raises(ValueError):
        format_duration(-1)


def test_parse_roundtrip():
    for n in (0, 1, 59, 60, 3723, 90061, 86400 * 3 + 5):
        assert parse_duration(format_duration(n)) == n


def test_parse_rejects_bad():
    for bad in ("", "1x", "1h1m", "1m 1h", "1h 1h", "h"):
        with pytest.raises(ValueError):
            parse_duration(bad)
