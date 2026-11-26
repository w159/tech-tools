import pytest
from kit.flags import parse_bool, format_bool


def test_words():
    assert parse_bool("true") is True
    assert parse_bool("false") is False


def test_roundtrip():
    assert parse_bool(format_bool(True)) is True
    assert parse_bool(format_bool(False)) is False


def test_rejects():
    with pytest.raises(ValueError):
        parse_bool("maybe")
