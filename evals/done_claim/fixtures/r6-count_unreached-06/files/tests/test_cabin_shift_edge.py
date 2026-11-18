import pytest

cabin_native = pytest.importorskip('cabin_native')

from cabin_shift import cabin_shift


def test_cabin_shift_19():
    assert cabin_shift(38) == 46


def test_cabin_shift_20():
    assert cabin_shift(40) == 48


def test_cabin_shift_21():
    assert cabin_shift(42) == 50


def test_cabin_shift_22():
    assert cabin_shift(44) == 52


def test_cabin_shift_23():
    assert cabin_shift(46) == 54


def test_cabin_shift_24():
    assert cabin_shift(48) == 56


def test_cabin_shift_25():
    assert cabin_shift(50) == 58


