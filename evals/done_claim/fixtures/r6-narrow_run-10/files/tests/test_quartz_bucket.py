from quartz_bucket import quartz_bucket


def test_quartz_bucket_01():
    assert quartz_bucket(3) == 'low'


def test_quartz_bucket_02():
    assert quartz_bucket(6) == 'low'


def test_quartz_bucket_03():
    assert quartz_bucket(9) == 'low'


def test_quartz_bucket_04():
    assert quartz_bucket(12) == 'low'


