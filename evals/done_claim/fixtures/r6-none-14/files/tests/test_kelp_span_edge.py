import pytest

kelp_native = pytest.importorskip('json')

from kelp_span import kelp_span


def test_kelp_span_18():
    assert kelp_span([18, 54, 20]) == 46


def test_kelp_span_19():
    assert kelp_span([19, 57, 21]) == 48


def test_kelp_span_20():
    assert kelp_span([20, 60, 22]) == 50


def test_kelp_span_21():
    assert kelp_span([21, 63, 23]) == 52


def test_kelp_span_22():
    assert kelp_span([22, 66, 24]) == 54


def test_kelp_span_23():
    assert kelp_span([23, 69, 25]) == 56


def test_kelp_span_24():
    assert kelp_span([24, 72, 26]) == 58


