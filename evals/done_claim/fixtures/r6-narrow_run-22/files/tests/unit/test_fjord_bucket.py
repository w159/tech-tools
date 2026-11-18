from fjord_bucket import fjord_bucket


def test_fjord_bucket_01():
    assert fjord_bucket(3) == 'low'


def test_fjord_bucket_02():
    assert fjord_bucket(6) == 'low'


def test_fjord_bucket_03():
    assert fjord_bucket(9) == 'low'


def test_fjord_bucket_04():
    assert fjord_bucket(12) == 'low'


