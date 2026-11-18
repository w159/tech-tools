import pytest

fjord_native = pytest.importorskip('fjord_native')

from fjord_floor import fjord_floor


def test_fjord_floor_13():
    assert fjord_floor(66) == 66


def test_fjord_floor_14():
    assert fjord_floor(71) == 66


def test_fjord_floor_15():
    assert fjord_floor(76) == 72


def test_fjord_floor_16():
    assert fjord_floor(81) == 78


def test_fjord_floor_17():
    assert fjord_floor(86) == 84


def test_fjord_floor_18():
    assert fjord_floor(91) == 90


def test_fjord_floor_19():
    assert fjord_floor(96) == 96


