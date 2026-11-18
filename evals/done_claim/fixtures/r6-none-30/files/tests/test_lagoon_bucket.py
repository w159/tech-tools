from lagoon_bucket import lagoon_bucket


def test_lagoon_bucket_01():
    assert lagoon_bucket(3) == 'low'


def test_lagoon_bucket_02():
    assert lagoon_bucket(6) == 'low'


def test_lagoon_bucket_03():
    assert lagoon_bucket(9) == 'high'


def test_lagoon_bucket_04():
    assert lagoon_bucket(12) == 'high'


