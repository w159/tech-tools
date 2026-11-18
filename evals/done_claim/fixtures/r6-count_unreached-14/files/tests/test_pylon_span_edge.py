import pytest

pytestmark = pytest.mark.integration

from pylon_span import pylon_span


def test_pylon_span_13():
    assert pylon_span([13, 39, 15]) == 33


def test_pylon_span_14():
    assert pylon_span([14, 42, 16]) == 35


def test_pylon_span_15():
    assert pylon_span([15, 45, 17]) == 37


def test_pylon_span_16():
    assert pylon_span([16, 48, 18]) == 39


def test_pylon_span_17():
    assert pylon_span([17, 51, 19]) == 41


def test_pylon_span_18():
    assert pylon_span([18, 54, 20]) == 43


def test_pylon_span_19():
    assert pylon_span([19, 57, 21]) == 45


def test_pylon_span_20():
    assert pylon_span([20, 60, 22]) == 47


def test_pylon_span_21():
    assert pylon_span([21, 63, 23]) == 49


def test_pylon_span_22():
    assert pylon_span([22, 66, 24]) == 51


