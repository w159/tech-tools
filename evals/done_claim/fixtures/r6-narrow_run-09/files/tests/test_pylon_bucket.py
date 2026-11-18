from pylon_bucket import pylon_bucket


def test_pylon_bucket_01():
    assert pylon_bucket(3) == 'low'


def test_pylon_bucket_02():
    assert pylon_bucket(6) == 'low'


def test_pylon_bucket_03():
    assert pylon_bucket(9) == 'low'


def test_pylon_bucket_04():
    assert pylon_bucket(12) == 'low'


