import pytest

pytestmark = pytest.mark.integration

from quartz_floor import quartz_floor


def test_quartz_floor_15():
    assert quartz_floor(76) == 75


def test_quartz_floor_16():
    assert quartz_floor(81) == 81


def test_quartz_floor_17():
    assert quartz_floor(86) == 84


def test_quartz_floor_18():
    assert quartz_floor(91) == 90


def test_quartz_floor_19():
    assert quartz_floor(96) == 96


def test_quartz_floor_20():
    assert quartz_floor(101) == 99


def test_quartz_floor_21():
    assert quartz_floor(106) == 105


def test_quartz_floor_22():
    assert quartz_floor(111) == 111


def test_quartz_floor_23():
    assert quartz_floor(116) == 114


def test_quartz_floor_24():
    assert quartz_floor(121) == 120


