import pytest

tundra_native = pytest.importorskip('tundra_native')

from tundra_bucket import tundra_bucket


def test_tundra_bucket_15():
    assert tundra_bucket(45) == 'high'


def test_tundra_bucket_16():
    assert tundra_bucket(48) == 'high'


def test_tundra_bucket_17():
    assert tundra_bucket(51) == 'high'


def test_tundra_bucket_18():
    assert tundra_bucket(54) == 'high'


def test_tundra_bucket_19():
    assert tundra_bucket(57) == 'high'


def test_tundra_bucket_20():
    assert tundra_bucket(60) == 'high'


def test_tundra_bucket_21():
    assert tundra_bucket(63) == 'high'


