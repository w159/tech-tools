import pytest
from kit.flags import parse_bool, format_bool


def test_true_words():
    for w in ("true", "yes", "on", "1", " TRUE ", "Yes"):
        assert parse_bool(w) is True


def test_false_words():
    for w in ("false", "no", "off", "0", "OFF"):
        assert parse_bool(w) is False


def test_reject_message():
    with pytest.raises(ValueError) as e:
        parse_bool("maybe")
    assert str(e.value) == "not a boolean: 'maybe'"


def test_reject_others():
    for w in ("", "y", "n", "t", "2"):
        with pytest.raises(ValueError):
            parse_bool(w)


def test_non_str():
    with pytest.raises(TypeError):
        parse_bool(1)


def test_format():
    assert format_bool(True) == "yes"
    assert format_bool(False) == "no"
